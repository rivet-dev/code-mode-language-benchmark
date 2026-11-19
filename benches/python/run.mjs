// Python: Pyodide (restored from a memory snapshot) and MicroPython embedded in Node as Wasm,
// CPython as a separate process, and CPython forked from a warm parent.
//
// Measures, one after another:
//   py_inproc.mjs: MicroPython start, memory and tool call, and Pyodide loaded fresh;
//   pyodide_snapshot.mjs: Pyodide restored from a snapshot, the configuration charted;
//   fork_bench.py: CPython forks, with start and cgroup memory in one memory-accounted scope;
//   the shared process suite and cgroup memory for CPython;
//   compute for Pyodide, MicroPython and CPython.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_PATH, runCompute } from "../common/compute/run.mjs";
import { MEMORY_CGROUP, MEMORY_SCOPE, ROOT, SUITE, bytes, firstLine, runHarness, writeRaw, writeResult } from "../common/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNTIMES_MODULE = path.join(here, "process_runtimes.mjs");
const packageVersion = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")).version;
if (!fs.existsSync(path.join(ROOT, "node_modules/pyodide"))) throw new Error("run npm install first");

const node = process.version.slice(1);
const micropythonVersion = packageVersion("@micropython/micropython-webassembly-pyscript");
const cpythonVersion = firstLine("python3", ["--version"]).replace(/^Python /, "");

const inproc = runHarness("py_inproc", process.execPath, ["--expose-gc", path.join(here, "py_inproc.mjs")]);
writeRaw("python", "py-inproc", inproc);
const snapshot = runHarness("pyodide_snapshot", process.execPath, ["--expose-gc", path.join(here, "pyodide_snapshot.mjs")]);
writeRaw("python", "pyodide-snapshot", snapshot);
const fork = runHarness("fork_bench", MEMORY_SCOPE[0], [...MEMORY_SCOPE.slice(1), "python3", path.join(here, "fork_bench.py")]);
writeRaw("python", "fork", fork);
const suite = runHarness("process suite", process.execPath, [SUITE, RUNTIMES_MODULE]);
writeRaw("python", "process-suite", suite);
const memory = runHarness("process memory", MEMORY_SCOPE[0], [...MEMORY_SCOPE.slice(1), process.execPath, MEMORY_CGROUP, RUNTIMES_MODULE]);
writeRaw("python", "process-memory", memory);

const task = path.join(here, "compute/task.py");
const embeddedHost = path.join(here, "compute/embedded.mjs");
const compute = runCompute([
	{ key: "pyodide", command: process.execPath, args: [embeddedHost, "pyodide", task, DATA_PATH] },
	{ key: "micropython", command: process.execPath, args: [embeddedHost, "micropython", task, DATA_PATH] },
	{ key: "cpython", command: "python3", args: ["-I", path.join(here, "compute/process.py"), task, DATA_PATH] },
]);
writeRaw("python", "compute", { output: compute, started: compute.entries.pyodide.started, finished: compute.entries.cpython.finished });

const pyodide = snapshot.output;
const fresh = inproc.output.pyodide;
const micropython = inproc.output.micropython;

writeResult({
	runtime: "pyodide",
	label: "Pyodide snapshot",
	language: "Python",
	group: "embedded",
	host: `Node ${node} (pyodide ${fresh.version}, restored from a memory snapshot)`,
	version: `Pyodide ${fresh.version}`,
	metrics: { memoryBytes: pyodide.memoryBytesPerInstance, startMs: pyodide.startMs, toolCallUs: pyodide.toolCall.wallUs, computeMs: compute.entries.pyodide.medianMs },
	notes: [
		`Every instance is restored from one ${bytes(pyodide.snapshotBytes)} memory snapshot taken after a fresh load; all instances share one JavaScript realm, so they count as a boundary only with the JavaScript bridge locked down.`,
		"Memory: resident growth of the Node host across 6 live instances, after three forced GCs before and after.",
		"Start: median of the last 6 of 7 restores, each through runPython(\"1 + 1\").",
		`Tool call: Python awaits an async host function registered with registerJsModule. Median of per-batch means, 20,000 calls in batches of 500 after 2,000 warm-ups; ${pyodide.toolCall.cpuUs} µs of CPU per call.`,
		`Loaded fresh instead of from a snapshot (py_inproc.mjs), start is ${fresh.startMs} ms and memory ${bytes(fresh.memoryBytesPerInstance)} per instance.`,
		"Compute: one freshly loaded instance runs the task with the json module's C accelerator; strings cross between JavaScript and Python through Pyodide's automatic conversion.",
	],
	runs: [snapshot, inproc, compute.entries.pyodide],
});

writeResult({
	runtime: "micropython",
	label: "µPython (Wasm)",
	language: "Python",
	group: "embedded",
	host: `Node ${node} (@micropython/micropython-webassembly-pyscript ${micropythonVersion})`,
	version: `MicroPython ${micropythonVersion}`,
	metrics: { memoryBytes: micropython.memoryBytesPerInstance, startMs: micropython.startMs, toolCallUs: micropython.toolCall.wallUs, computeMs: compute.entries.micropython.medianMs },
	notes: [
		"An instance is one loadMicroPython() call (default heap) that runs first_response = 1 + 1 and reads it back through globals.",
		"Memory: resident growth of the Node host across 20 live instances, after three forced GCs before and after.",
		"Start: median of the last 20 of 22 loads.",
		`Tool call: Python awaits an async host function. MicroPython's JavaScript bridge keeps per-realm state, so only the newest instance in a realm can make host calls; the newest of the 20 is measured. Median of per-batch means, 20,000 calls in batches of 500 after 2,000 warm-ups; ${micropython.toolCall.cpuUs} µs of CPU per call.`,
		"Compute: one instance with its heap raised to 256 MiB, because the default cannot hold the parsed dataset; json is MicroPython's built-in C module and the interpreter has no JIT.",
	],
	runs: [inproc, compute.entries.micropython],
});

const cpython = suite.output.runtimes.cpython;
const charged = memory.output.runtimes.cpython;
writeResult({
	runtime: "cpython",
	label: "CPython",
	language: "Python",
	group: "process",
	host: `Node ${node} (spawns the process and talks to it over stdio)`,
	version: `CPython ${cpythonVersion}`,
	metrics: { memoryBytes: charged.bytesPerSandbox, startMs: cpython.startMs, toolCallUs: cpython.toolCall.wallUs, computeMs: compute.entries.cpython.medianMs },
	notes: [
		"Started as python3 -c, which prints 1 + 1 and then reads stdin until it closes.",
		`Memory: cgroup charge per added process, median of 3 rounds of 20; USS ${bytes(cpython.memory.ussBytes)}, PSS ${bytes(cpython.memory.pssBytes)}.`,
		"Start: median of 40 spawns until the host reads the first line.",
		`Tool call: guest.py writes each call with json.dumps and reads the reply with readline. Per-call median over 50,000 calls after 5,000 warm-ups; median of 500-call batches ${cpython.toolCall.batchWallUs} µs; ${cpython.toolCall.cpuUs} µs of CPU per call across host and process.`,
		"Compute: the loop runs inside python3 -I and is timed with time.perf_counter_ns(); default interpreter settings with the json module's C accelerator.",
	],
	runs: [suite, memory, compute.entries.cpython],
});

const forked = fork.output;
writeResult({
	runtime: "cpython-fork",
	label: "CPython fork",
	language: "Python",
	group: "process",
	host: `CPython ${forked.python} (fork_bench.py forks from a warm parent)`,
	version: `CPython ${forked.python}`,
	metrics: { memoryBytes: forked.cgroupBytesPerChild, startMs: forked.startMs, toolCallUs: null, computeMs: null },
	notes: [
		"The parent runs gc.collect() and gc.freeze(), as a zygote would, then forks children that write 1 + 1 to a pipe.",
		`Memory: cgroup charge per child across 20 live children; USS ${bytes(forked.ussBytes)}, PSS ${bytes(forked.pssBytes)}. A child shares its parent's pages until it writes to them, so it grows as a script runs.`,
		"Start: median of 40 forks until the parent reads the answer.",
		"Tool call and compute are not measured separately: a forked child runs the same interpreter as the CPython row.",
	],
	runs: [fork],
});
console.error("[python] done");
