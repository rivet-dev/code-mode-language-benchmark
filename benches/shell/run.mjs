// Shells: bash and dash as separate processes, through the shared process suite and cgroup memory.
// Neither has a JSON parser, so the compute task does not apply.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MEMORY_CGROUP, MEMORY_SCOPE, SUITE, bytes, firstLine, runHarness, writeRaw, writeResult } from "../common/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNTIMES_MODULE = path.join(here, "process_runtimes.mjs");

/** dash has no version flag; ask the package manager, and fall back to the bare name. */
function dashVersion() {
	const query = spawnSync("dpkg-query", ["-W", "-f=${Version}", "dash"], { encoding: "utf8" });
	return query.status === 0 ? `dash ${query.stdout.trim().replace(/-[^-]*$/, "")}` : "dash";
}

const bashVersion = `bash ${firstLine("bash", ["--version"]).match(/version ([\d.]+)/)[1]}`;
const suite = runHarness("process suite", process.execPath, [SUITE, RUNTIMES_MODULE]);
writeRaw("shell", "process-suite", suite);
const memory = runHarness("process memory", MEMORY_SCOPE[0], [...MEMORY_SCOPE.slice(1), process.execPath, MEMORY_CGROUP, RUNTIMES_MODULE]);
writeRaw("shell", "process-memory", memory);

const perCommand = suite.output.bashCommandPerCall.trueBinary;
const ROWS = [
	{
		key: "bash",
		label: "bash",
		version: bashVersion,
		start: "bash -c, which echoes $((1 + 1)) and then waits on read",
		guest: "guest.sh formats each call with printf and matches the reply's id with a regex",
		extra: `A shell that calls a tool by running one external command per call (/bin/true) pays ${perCommand.wallUs} µs per call and ${perCommand.cpuUs} µs of CPU, the floor for calling a CLI tool.`,
	},
	{
		key: "dash",
		label: "dash",
		version: dashVersion(),
		start: "dash -c, which echoes $((1 + 1)) and then waits on read",
		guest: "guest_dash.sh formats each call with printf and cuts the reply's id out with parameter expansion",
	},
];
for (const row of ROWS) {
	const result = suite.output.runtimes[row.key];
	const charged = memory.output.runtimes[row.key];
	writeResult({
		runtime: row.key,
		label: row.label,
		language: "Shell",
		group: "process",
		host: `Node ${process.version.slice(1)} (spawns the process and talks to it over stdio)`,
		version: row.version,
		metrics: { memoryBytes: charged.bytesPerSandbox, startMs: result.startMs, toolCallUs: result.toolCall.wallUs, computeMs: null },
		notes: [
			`Started as ${row.start}.`,
			`Memory: cgroup charge per added process, median of 3 rounds of 20; USS ${bytes(result.memory.ussBytes)}, PSS ${bytes(result.memory.pssBytes)}.`,
			"Start: median of 40 spawns until the host reads the first line.",
			`Tool call: ${row.guest}. Per-call median over 50,000 calls after 5,000 warm-ups; median of 500-call batches ${result.toolCall.batchWallUs} µs; ${result.toolCall.cpuUs} µs of CPU per call across host and process.`,
			...(row.extra ? [row.extra] : []),
			"Compute: not applicable, the shell has no JSON parser.",
		],
		runs: [suite, memory],
	});
}
console.error("[shell] done");
