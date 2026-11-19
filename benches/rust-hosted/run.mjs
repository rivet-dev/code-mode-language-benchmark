// Scripting engines embedded in a Rust host: one standalone crate per engine under engines/, all
// sharing the harness in common/ (the same start, memory and tool call definitions as the C Lua
// host). Each engine builds in release with fat LTO into its own target directory, then each
// binary runs in its own fresh process, one after another: memory first, then start, then tool
// calls, then one JSON line on stdout.
//
// Set CARGO_TARGET_DIR to reuse an existing build; each engine builds into <dir>/<engine>.
// The default is benches/rust-hosted/target.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { count, runHarness, writeRaw, writeResult } from "../common/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TARGET_ROOT = path.resolve(process.env.CARGO_TARGET_DIR ?? path.join(here, "target"));
const TIMEOUT_MS = 30 * 60_000;
const EXTRA_NOTES = JSON.parse(fs.readFileSync(path.join(here, "extra_notes.json"), "utf8"));

// Engine directory, results key, chart-style label and the language a model writes.
const ENGINES = [
	{ engine: "luau", runtime: "luau", label: "Luau", language: "Luau" },
	{ engine: "quickjs", runtime: "rquickjs", label: "QuickJS-ng (rquickjs)", language: "JavaScript" },
	{ engine: "rhai", runtime: "rhai", label: "Rhai", language: "Rhai" },
	{ engine: "rune", runtime: "rune", label: "Rune", language: "Rune" },
	{ engine: "koto", runtime: "koto", label: "Koto", language: "Koto" },
	{ engine: "roto", runtime: "roto", label: "Roto", language: "Roto" },
	{ engine: "steel", runtime: "steel", label: "Steel", language: "Scheme" },
	{ engine: "starlark", runtime: "starlark", label: "Starlark", language: "Starlark" },
	{ engine: "boa", runtime: "boa", label: "Boa", language: "JavaScript" },
	{ engine: "monty", runtime: "monty", label: "Monty", language: "Python (subset)" },
];

const binary = (engine) => path.join(TARGET_ROOT, engine, "release", `bench-${engine}`);

/** Builds one engine with cargo, logging to <target>/<engine>/build.log. */
function cargoBuild(engine) {
	const directory = path.join(TARGET_ROOT, engine);
	fs.mkdirSync(directory, { recursive: true });
	const log = fs.openSync(path.join(directory, "build.log"), "w");
	const child = spawn("cargo", ["build", "--release", "--locked"], {
		cwd: path.join(here, "engines", engine),
		env: { ...process.env, CARGO_TARGET_DIR: directory },
		stdio: ["ignore", log, log],
	});
	return new Promise((resolve) => {
		child.on("close", (code) => {
			fs.closeSync(log);
			resolve({ engine, code });
		});
	});
}

/** The rustc that built a binary, read from its .comment section like the original runner did. */
function rustcVersion(file) {
	const comment = spawnSync("readelf", ["-p", ".comment", file], { encoding: "utf8" }).stdout ?? "";
	const match = comment.match(/rustc version ([\d.]+)/);
	if (match) return match[1];
	return spawnSync("rustc", ["--version"], { cwd: here, encoding: "utf8" }).stdout.split(" ")[1];
}

// Build every engine in parallel: each is one crate whose fat-LTO link runs on one core.
console.error(`[rust-hosted] building ${ENGINES.length} engines into ${TARGET_ROOT.startsWith(here) ? path.relative(here, TARGET_ROOT) : "CARGO_TARGET_DIR"}`);
const builds = await Promise.all(ENGINES.map(({ engine }) => cargoBuild(engine)));
const failed = builds.filter((result) => result.code !== 0);
for (const { engine } of failed) {
	const log = fs.readFileSync(path.join(TARGET_ROOT, engine, "build.log"), "utf8");
	console.error(`[rust-hosted] ${engine} build failed:\n${log.split("\n").slice(-30).join("\n")}`);
}
if (failed.length > 0) throw new Error(`builds failed: ${failed.map((result) => result.engine).join(", ")}`);

// Run each engine alone, in its own process, one after another.
const runs = {};
for (const { engine } of ENGINES) {
	runs[engine] = runHarness(`rust ${engine}`, binary(engine), [], { cwd: here, timeoutMs: TIMEOUT_MS });
	writeRaw("rust-hosted", engine, runs[engine]);
}

for (const row of ENGINES) {
	const result = runs[row.engine].output;
	const crate = result.crate.split(" ")[0];
	const callKind = result.callKind === "async"
		? "the guest suspends at each call and the host resumes it with the reply"
		: "the guest calls a registered Rust function on its own stack";
	writeResult({
		runtime: row.runtime,
		label: row.label,
		language: row.language,
		group: "embedded",
		host: `Rust ${rustcVersion(binary(row.engine))} (${result.crate} ${result.version}, release, fat LTO)`,
		version: `${crate} ${result.version}`,
		metrics: { memoryBytes: result.memoryBytesPerSession, startMs: result.startUs / 1e3, toolCallUs: result.toolCallWallUs, computeMs: null },
		notes: [
			`A session builds the whole engine (nothing shared between sessions), applies its limits, registers the host call function, then evaluates 1 + 1 and reads 2 back in Rust. Limits: ${result.limitsEnabled}.`,
			`Memory: resident growth across ${count(result.memorySessions)} live sessions (stopped by ${result.memoryStoppedBy}), measured first in a fresh process.`,
			`Start: median of ${count(result.startRuns)} creates.`,
			`Tool call: ${callKind}. Median of per-batch means, ${count(result.toolCallMeasuredCalls)} calls in batches of ${count(result.toolCallBatchSize)} after ${count(result.toolCallWarmupCalls)} warm-ups; mean ${result.toolCallWallMeanUs} µs, slowest batch ${result.toolCallSlowestBatchUs} µs per call; ${result.toolCallCpuUs} µs of CPU per call.`,
			...result.notes,
			...(EXTRA_NOTES[row.engine] ?? []),
			"Compute: not measured in the Rust host.",
		],
		runs: [runs[row.engine]],
	});
}
console.error("[rust-hosted] done");
