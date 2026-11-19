// Helpers shared by the language runners: run a harness, record when it ran and the load around
// it, and write results in the one normalized schema every results file uses.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RESULTS_DIR = path.join(ROOT, "results");
export const RAW_DIR = path.join(RESULTS_DIR, "raw");
export const SUITE = path.join(ROOT, "benches/common/suite.mjs");
export const MEMORY_CGROUP = path.join(ROOT, "benches/common/memory_cgroup.mjs");

/** Prefix that runs a command in its own memory-accounted systemd user scope. */
export const MEMORY_SCOPE = ["systemd-run", "--user", "--scope", "--quiet", "-p", "MemoryAccounting=yes"];

const GIB = 1024 ** 3;
const METRICS = ["memoryBytes", "startMs", "toolCallUs", "computeMs"];

/** The 1, 5 and 15 minute load averages, rounded to two decimals. */
export function loadAverage() {
	return os.loadavg().map((value) => Math.round(value * 100) / 100);
}

/** Shows a path relative to the repository, so logs and notes never carry absolute paths. */
export function relative(value) {
	return typeof value === "string" && path.isAbsolute(value) && value.startsWith(ROOT) ? path.relative(ROOT, value) || "." : value;
}

/** Returns the first line a command prints on stdout or stderr, or null if it cannot run. */
export function firstLine(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (result.error) return null;
	return `${result.stdout}\n${result.stderr}`.trim().split("\n")[0].trim() || null;
}

/** Parses a harness's stdout: one JSON document, or JSON on its last line beginning with "{". */
function parseJsonOutput(name, stdout) {
	try {
		return JSON.parse(stdout);
	} catch {
		const lines = stdout.trim().split("\n").filter((line) => line.startsWith("{"));
		if (lines.length === 0) throw new Error(`${name} printed no JSON`);
		return JSON.parse(lines[lines.length - 1]);
	}
}

/**
 * Runs one harness to completion and returns its JSON output, with when it ran and the load
 * average before and after. stderr streams to the console so progress stays visible.
 */
export function runHarness(name, command, args, options = {}) {
	console.error(`[${name}] ${[command, ...args].map(relative).join(" ")}`);
	const started = { at: new Date().toISOString(), load: loadAverage() };
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? ROOT,
		env: options.env ?? process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: 256 << 20,
		timeout: options.timeoutMs ?? 30 * 60_000,
	});
	const finished = { at: new Date().toISOString(), load: loadAverage() };
	if (result.error) throw new Error(`${name}: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`${name} exited with ${result.status ?? result.signal}`);
	return { output: parseJsonOutput(name, result.stdout), started, finished };
}

/** Runs a build step, streaming its output, and throws if it fails. */
export function build(command, args, options = {}) {
	console.error(`[build] ${[command, ...args].map(relative).join(" ")}`);
	const result = spawnSync(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
	if (result.error) throw new Error(`${command}: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

/** Writes a harness's own output, unchanged, to results/raw/<language>/<name>.json. */
export function writeRaw(language, name, run) {
	const directory = path.join(RAW_DIR, language);
	fs.mkdirSync(directory, { recursive: true });
	const document = { harness: name, startedAt: run.started.at, finishedAt: run.finished.at, loadAverage: { start: run.started.load, end: run.finished.load }, output: run.output };
	fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(document, null, 2)}\n`);
}

/** Keeps five significant digits, enough for every metric without float noise. */
function tidy(value) {
	return value === null || value === undefined ? null : Number(value.toPrecision(5));
}

/**
 * Writes results/<runtime>.json in the normalized schema. `runs` are the harness runs that
 * produced this runtime's metrics; they give measuredAt (the last one to finish) and the load
 * average at the start of the first and the end of the last.
 */
export function writeResult({ runtime, label, language, group, host, version, metrics, notes, runs }) {
	for (const [field, value] of Object.entries({ runtime, label, language, host, version })) {
		if (typeof value !== "string" || value.length === 0) throw new Error(`${runtime}: ${field} must be a non-empty string`);
	}
	if (group !== "embedded" && group !== "process") throw new Error(`${runtime}: group must be embedded or process`);
	for (const name of Object.keys(metrics)) {
		if (!METRICS.includes(name)) throw new Error(`${runtime}: unknown metric ${name}`);
	}
	for (const name of METRICS) {
		const value = metrics[name];
		if (value !== null && value !== undefined && !(Number.isFinite(value) && value > 0)) throw new Error(`${runtime}: ${name} is ${value}`);
	}
	const ordered = [...runs].sort((first, second) => first.started.at.localeCompare(second.started.at));
	const last = [...runs].sort((first, second) => first.finished.at.localeCompare(second.finished.at)).at(-1);
	const memoryBytes = metrics.memoryBytes ? Math.round(metrics.memoryBytes) : null;
	const result = {
		runtime,
		label,
		language,
		group,
		host,
		version,
		metrics: {
			memoryBytes,
			startMs: tidy(metrics.startMs),
			toolCallUs: tidy(metrics.toolCallUs),
			computeMs: tidy(metrics.computeMs),
			instancesPerGiB: memoryBytes ? Math.round(GIB / memoryBytes) : null,
		},
		notes,
		measuredAt: last.finished.at,
		loadAverage: { start: ordered[0].started.load, end: last.finished.load },
	};
	fs.mkdirSync(RESULTS_DIR, { recursive: true });
	fs.writeFileSync(path.join(RESULTS_DIR, `${runtime}.json`), `${JSON.stringify(result, null, 2)}\n`);
	console.error(`[results] ${runtime}: ${JSON.stringify(result.metrics)}`);
}

/** Formats an integer with thousands separators for notes. */
export function count(value) {
	return Math.round(value).toLocaleString("en-US");
}

/** Formats a byte count for notes: KiB below one MiB, MiB above. */
export function bytes(value) {
	return value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(2)} MiB`;
}
