// JavaScript: V8 (through isolated-vm) and QuickJS (compiled to Wasm) embedded in Node, and Node,
// Deno and Bun as separate processes.
//
// Measures, one after another:
//   inproc.mjs: V8 and QuickJS start and memory;
//   v8_op.mjs: the V8 tool call through a same-thread, op-style binding;
//   cpu_bench.mjs: the QuickJS tool call, plus V8 through isolated-vm's own sync and async APIs;
//   the shared process suite and cgroup memory for Node, Deno and Bun;
//   compute for all five.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_PATH, runCompute } from "../common/compute/run.mjs";
import { MEMORY_CGROUP, MEMORY_SCOPE, ROOT, SUITE, bytes, firstLine, runHarness, writeRaw, writeResult } from "../common/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNTIMES_MODULE = path.join(here, "process_runtimes.mjs");
const packageVersion = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")).version;
if (!fs.existsSync(path.join(ROOT, "node_modules/isolated-vm"))) throw new Error("run npm install first");

const node = process.version.slice(1);
const ivmVersion = packageVersion("isolated-vm");
const quickjsVersion = packageVersion("quickjs-emscripten");
const denoVersion = firstLine("deno", ["--version"]).match(/^deno ([\d.]+)/)[1];
const bunVersion = firstLine("bun", ["--version"]);

const inproc = runHarness("inproc", process.execPath, ["--expose-gc", path.join(here, "inproc.mjs")]);
writeRaw("javascript", "inproc", inproc);
const opBinding = runHarness("v8_op", process.execPath, [path.join(here, "v8_op.mjs")]);
writeRaw("javascript", "v8-op", opBinding);
const callCosts = runHarness("cpu_bench", process.execPath, [path.join(here, "cpu_bench.mjs"), here]);
writeRaw("javascript", "cpu-bench", callCosts);
const suite = runHarness("process suite", process.execPath, [SUITE, RUNTIMES_MODULE]);
writeRaw("javascript", "process-suite", suite);
const memory = runHarness("process memory", MEMORY_SCOPE[0], [...MEMORY_SCOPE.slice(1), process.execPath, MEMORY_CGROUP, RUNTIMES_MODULE]);
writeRaw("javascript", "process-memory", memory);

const task = path.join(here, "compute/task.js");
const embeddedHost = path.join(here, "compute/embedded.mjs");
const processHost = path.join(here, "compute/process.mjs");
const compute = runCompute([
	{ key: "quickjs", command: process.execPath, args: [embeddedHost, "quickjs", task, DATA_PATH] },
	{ key: "v8", command: process.execPath, args: [embeddedHost, "v8", task, DATA_PATH] },
	{ key: "node", command: "node", args: [processHost, task, DATA_PATH] },
	{ key: "deno", command: "deno", args: ["run", "--quiet", "--allow-read", processHost, task, DATA_PATH] },
	{ key: "bun", command: "bun", args: [processHost, task, DATA_PATH] },
]);
writeRaw("javascript", "compute", { output: compute, started: compute.entries.quickjs.started, finished: compute.entries.bun.finished });

const v8 = inproc.output.v8Isolate;
const quickjs = inproc.output.quickjsOwnModule;
const op = opBinding.output.v8IsolateOpStyle;
const costs = callCosts.output;

writeResult({
	runtime: "v8",
	label: "V8 (isolated-vm)",
	language: "JavaScript",
	group: "embedded",
	host: `Node ${node} (isolated-vm ${ivmVersion})`,
	version: `V8 ${process.versions.v8}`,
	metrics: { memoryBytes: v8.memoryBytesPerSession, startMs: v8.createMs, toolCallUs: op.wallUs, computeMs: compute.entries.v8.medianMs },
	notes: [
		"An instance is one isolated-vm Isolate (memoryLimit 128 MB) plus one context, created and evaluating 1 + 1 synchronously.",
		"Memory: resident growth of the Node host across 200 live instances, after two forced GCs before and after.",
		"Start: median of 40 creates after 3 warm-ups.",
		`Tool call: v8_op.mjs. The guest starts each call with a synchronous host call and awaits a promise that the host resolves from the same thread, as deno_core ops do. Median of per-batch means, 20,000 calls in batches of 100 after 2,000 warm-ups; ${op.cpuUs} µs of CPU per call.`,
		`The same call through isolated-vm's async API costs ${costs.v8IsolateAsync.wallUs} µs (cpu_bench.mjs), and ${inproc.output.v8Isolate.toolCallUs} µs when the host answers on a later event-loop turn (inproc.mjs); a fully synchronous applySync call costs ${costs.v8IsolateSync.wallUs} µs.`,
		"Compute: one isolate (memoryLimit 1024 MB) runs the task through applySync; the host times each call, which copies the JSON text in and the result text out.",
	],
	runs: [inproc, opBinding, compute.entries.v8],
});

writeResult({
	runtime: "quickjs",
	label: "QuickJS (Wasm)",
	language: "JavaScript",
	group: "embedded",
	host: `Node ${node} (quickjs-emscripten ${quickjsVersion}, RELEASE_SYNC)`,
	version: `QuickJS through quickjs-emscripten ${quickjsVersion}`,
	metrics: { memoryBytes: quickjs.memoryBytesPerSession, startMs: quickjs.createMs, toolCallUs: costs.quickjsOwnModuleAsync.wallUs, computeMs: compute.entries.quickjs.medianMs },
	notes: [
		`An instance is its own Wasm module instance with its own linear memory, instantiated from one WebAssembly.Module compiled once (${quickjs.compileOnceMs} ms), plus a runtime with a 64 MiB memory limit and a context.`,
		"Memory: resident growth of the Node host across 100 live instances, after two forced GCs before and after.",
		"Start: median of 40 creates after 3 warm-ups: instantiate the module, create the runtime and context, evaluate 1 + 1.",
		`Tool call: cpu_bench.mjs. The guest awaits an async host function that resolves its promise before returning it. Median of per-batch means, 20,000 calls in batches of 100 after 2,000 warm-ups; ${costs.quickjsOwnModuleAsync.cpuUs} µs of CPU per call, mostly quickjs-emscripten's handle API.`,
		`When the host answers on a later event-loop turn (inproc.mjs) a call costs ${quickjs.toolCallUs} µs per call, timed from one host call to the next.`,
		"Compute: one instance runs the task, interpreted (QuickJS has no JIT), with no memory limit or interrupt handler set.",
	],
	runs: [inproc, callCosts, compute.entries.quickjs],
});

const PROCESSES = [
	{ key: "node", label: "Node", version: `Node ${node}`, io: "node:readline for stdin" },
	{ key: "deno", label: "Deno", version: `Deno ${denoVersion}`, io: "Deno.stdin.readable for stdin" },
	{ key: "bun", label: "Bun", version: `Bun ${bunVersion}`, io: "Bun's console async iterator for stdin; Bun's Node-compat stdout costs it about 15 ms at startup, so it is avoided" },
];
for (const row of PROCESSES) {
	const result = suite.output.runtimes[row.key];
	const charged = memory.output.runtimes[row.key];
	writeResult({
		runtime: row.key,
		label: row.label,
		language: "JavaScript",
		group: "process",
		host: `Node ${node} (spawns the process and talks to it over stdio)`,
		version: row.version,
		metrics: { memoryBytes: charged.bytesPerSandbox, startMs: result.startMs, toolCallUs: result.toolCall.wallUs, computeMs: compute.entries[row.key].medianMs },
		notes: [
			`idle.mjs prints 1 + 1 with console.log and waits for stdin to close; guest.mjs uses ${row.io}.`,
			`Memory: cgroup charge per added process, median of 3 rounds of 20; USS ${bytes(result.memory.ussBytes)}, PSS ${bytes(result.memory.pssBytes)}.`,
			"Start: median of 40 spawns until the host reads the first line.",
			`Tool call: per-call median over 50,000 calls after 5,000 warm-ups; median of 500-call batches ${result.toolCall.batchWallUs} µs; ${result.toolCall.cpuUs} µs of CPU per call across host and process.`,
			"Compute: the loop runs inside the process and is timed with performance.now(); default JIT tiers.",
		],
		runs: [suite, memory, compute.entries[row.key]],
	});
}
console.error("[javascript] done");
