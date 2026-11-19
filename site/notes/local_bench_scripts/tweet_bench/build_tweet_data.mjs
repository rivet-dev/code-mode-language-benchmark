// Builds twitter/data.json for the chart page from the raw benchmark result files.
//
// Usage: node build_tweet_data.mjs <tweet-bench dir> <output data.json>
import fs from "node:fs";
import path from "node:path";

const [benchDir, outputPath] = process.argv.slice(2);
const load = (relative) => JSON.parse(fs.readFileSync(path.join(benchDir, relative), "utf8"));

const suite = load("suite/suite_results.json");
const lua = load("suite/lua55_results.json");
const luajit = load("suite/luajit_results.json");
const fork = load("suite/fork_results.json");
const isolates = load("inproc/results.json");
const callCosts = load("inproc/cpu_results.json");
const opBinding = load("inproc/v8_op_results.json");
const python = load("pyinproc/py_results.json");
const processMemory = load("suite/memory_cgroup.json").runtimes;
const forkMemory = load("suite/fork_cgroup.json");
const processes = suite.runtimes;

function bytesLabel(bytes) {
	if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
	return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 2 : 1)} MB`;
}

function msLabel(ms) {
	if (ms < 1) return `${Math.round(ms * 1e3)} µs`;
	if (ms >= 1000) return `${(ms / 1e3).toFixed(2)} s`;
	return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
}

function usLabel(us) {
	if (us >= 1000) return `${(us / 1e3).toFixed(1)} ms`;
	if (us < 1) return `${us.toFixed(2)} µs`;
	return `${us < 10 ? us.toFixed(1) : Math.round(us)} µs`;
}

const row = (group, name, logos, value, label) => ({ group, name, logos, value, label });
const memoryRow = (group, name, logos, bytes) => row(group, name, logos, bytes / 1e6, bytesLabel(bytes));
const startRow = (group, name, logos, ms) => row(group, name, logos, ms, msLabel(ms));
const callRow = (group, name, logos, us) => row(group, name, logos, us, usLabel(us));
const byValue = (rows) => [...rows].sort((first, second) => first.value - second.value);

const environment = `Linux x86-64, 48 cores, load average 4 to 25 during the runs. Node ${isolates.node.replace("v", "")}, Deno 2.5.2, Bun 1.3.14, CPython ${fork.python}, Lua 5.5.1, LuaJIT 2.1, bash 5.2, dash 0.5, isolated-vm 6.2, quickjs-emscripten 0.32, Pyodide ${python.pyodide.version}, MicroPython 1.29. Not yet measured this way: CPython on WASI, Monty, PocketPy.`;

const charts = [
	{
		id: "memory",
		file: "1-memory.png",
		title: "Memory each new sandbox adds",
		sub: "An idle sandbox after its first response. Embedded sandboxes share one host process; a separate process counts only its private memory.",
		unit: "MB",
		max: 30,
		ticks: [0, 10, 20, 30],
		rows: byValue([
			memoryRow("embedded", "Lua 5.5 state", ["lua"], lua.memoryBytesPerState),
			memoryRow("embedded", "LuaJIT state", ["luajit"], luajit.memoryBytesPerState),
			memoryRow("embedded", "QuickJS in Wasm", ["quickjs"], isolates.quickjsOwnModule.memoryBytesPerSession),
			memoryRow("embedded", "MicroPython in Wasm", ["micropython"], python.micropython.memoryBytesPerInstance),
			memoryRow("embedded", "V8 isolate", ["v8"], isolates.v8Isolate.memoryBytesPerSession),
			memoryRow("embedded", "Pyodide, shared isolate", ["pyodide"], python.pyodide.memoryBytesPerInstance),
		]).concat(byValue([
			memoryRow("process", "dash", ["dash"], processMemory.dash.bytesPerSandbox),
			memoryRow("process", "Lua", ["lua"], processMemory.lua.bytesPerSandbox),
			memoryRow("process", "LuaJIT", ["luajit"], processMemory.luajit.bytesPerSandbox),
			memoryRow("process", "CPython, forked from a warm parent", ["cpython"], forkMemory.cgroupBytesPerChild),
			memoryRow("process", "bash", ["bash"], processMemory.bash.bytesPerSandbox),
			memoryRow("process", "CPython", ["cpython"], processMemory.python.bytesPerSandbox),
			memoryRow("process", "Node.js", ["nodejs"], processMemory.node.bytesPerSandbox),
			memoryRow("process", "Bun", ["bun"], processMemory.bun.bytesPerSandbox),
			memoryRow("process", "Deno", ["deno"], processMemory.deno.bytesPerSandbox),
		])),
		note: `Embedded: resident growth per state, isolate, or Wasm module across 4 to 10,000 live sessions; Lua and LuaJIT run in a C host, the others in Node. Processes: memory charged to a cgroup per added process, above baseline, including the kernel's per-process memory; runtime code shared between processes is not counted. A forked CPython shares its warm parent's pages until it writes to them, so it grows as a script runs. Pyodide and MicroPython count as boundaries only with their JavaScript bridges locked down. ${environment}`,
	},
	{
		id: "start",
		file: "2-start.png",
		title: "Time from start to first response",
		sub: "From creating a sandbox until the host reads its answer to 1 + 1.",
		unit: "ms",
		max: 60,
		ticks: [0, 20, 40, 60],
		rows: byValue([
			startRow("embedded", "Lua 5.5 state", ["lua"], lua.startUs / 1e3),
			startRow("embedded", "LuaJIT state", ["luajit"], luajit.startUs / 1e3),
			startRow("embedded", "QuickJS in Wasm", ["quickjs"], isolates.quickjsOwnModule.createMs),
			startRow("embedded", "V8 isolate", ["v8"], isolates.v8Isolate.createMs),
			startRow("embedded", "MicroPython in Wasm", ["micropython"], python.micropython.startMs),
			startRow("embedded", "Pyodide from a snapshot", ["pyodide"], python.pyodide.snapshotStartMs),
			startRow("embedded", "Pyodide", ["pyodide"], python.pyodide.startMs),
		]).concat(byValue([
			startRow("process", "CPython, forked from a warm parent", ["cpython"], fork.startMs),
			startRow("process", "dash", ["dash"], processes.dash.startMs),
			startRow("process", "Lua", ["lua"], processes.lua.startMs),
			startRow("process", "LuaJIT", ["luajit"], processes.luajit.startMs),
			startRow("process", "bash", ["bash"], processes.bash.startMs),
			startRow("process", "CPython", ["cpython"], processes.python.startMs),
			startRow("process", "Node.js", ["nodejs"], processes.node.startMs),
			startRow("process", "Deno", ["deno"], processes.deno.startMs),
			startRow("process", "Bun", ["bun"], processes.bun.startMs),
		])),
		note: `Embedded: median of 40 to 2,000 creates, each through its first result; Pyodide, median of 5 loads. Processes: spawn until the host reads the first line of output, median of 40 runs, before the 1 to 5 ms that namespace setup adds. Bars that end in a break run past the axis. ${environment}`,
	},
	{
		id: "tool-call",
		file: "3-tool-call.png",
		title: "Tool call round trip in a running sandbox",
		sub: "Sandbox code sends one tool call and waits for the reply; the host answers at once. Median time per call.",
		unit: "µs",
		max: 240,
		ticks: [0, 50, 100, 150, 200],
		rows: byValue([
			callRow("embedded", "Lua 5.5 state", ["lua"], lua.toolCallWallUs),
			callRow("embedded", "LuaJIT state", ["luajit"], luajit.toolCallWallUs),
			callRow("embedded", "V8 isolate, same-thread binding", ["v8"], opBinding.v8IsolateOpStyle.wallUs),
			callRow("embedded", "QuickJS in Wasm", ["quickjs"], callCosts.quickjsOwnModuleAsync.wallUs),
			callRow("embedded", "V8 isolate, isolated-vm async API", ["v8"], callCosts.v8IsolateAsync.wallUs),
			callRow("embedded", "MicroPython in Wasm", ["micropython"], python.micropython.toolCall.wallUs),
			callRow("embedded", "Pyodide, shared isolate", ["pyodide"], python.pyodide.toolCall.wallUs),
		]).concat(byValue([
			callRow("process", "Lua", ["lua"], processes.lua.toolCall.wallUs),
			callRow("process", "LuaJIT", ["luajit"], processes.luajit.toolCall.wallUs),
			callRow("process", "Node.js", ["nodejs"], processes.node.toolCall.wallUs),
			callRow("process", "CPython", ["cpython"], processes.python.toolCall.wallUs),
			callRow("process", "dash", ["dash"], processes.dash.toolCall.wallUs),
			callRow("process", "Deno", ["deno"], processes.deno.toolCall.wallUs),
			callRow("process", "bash", ["bash"], processes.bash.toolCall.wallUs),
			callRow("process", "Bun", ["bun"], processes.bun.toolCall.wallUs),
			callRow("process", "bash, one command per call", ["bash"], suite.bashCommandPerCall.trueBinary.wallUs),
		])),
		note: `Calls are JSON-shaped: { id, tool, args }. Embedded Lua yields each call from a coroutine to a C host. The V8 same-thread binding starts the tool with a sync host call and the host resolves the promise, as deno_core ops do. Processes exchange JSON lines over stdio; Lua, bash, and dash match the reply's id with string patterns; "one command per call" runs /bin/true per call, the floor for a shell calling a CLI tool. Medians over 20,000 to 1,000,000 calls. Bars that end in a break run past the axis. ${environment}`,
	},
	{
		id: "tool-cpu",
		file: "4-tool-cpu.png",
		title: "CPU per tool call in a running sandbox",
		sub: "The same calls, counting CPU in every process involved: the host plus a separate sandbox process.",
		unit: "µs",
		max: 400,
		ticks: [0, 100, 200, 300, 400],
		rows: byValue([
			callRow("embedded", "Lua 5.5 state", ["lua"], lua.toolCallCpuUs),
			callRow("embedded", "LuaJIT state", ["luajit"], luajit.toolCallCpuUs),
			callRow("embedded", "V8 isolate, same-thread binding", ["v8"], opBinding.v8IsolateOpStyle.cpuUs),
			callRow("embedded", "V8 isolate, isolated-vm async API", ["v8"], callCosts.v8IsolateAsync.cpuUs),
			callRow("embedded", "QuickJS in Wasm", ["quickjs"], callCosts.quickjsOwnModuleAsync.cpuUs),
			callRow("embedded", "MicroPython in Wasm", ["micropython"], python.micropython.toolCall.cpuUs),
			callRow("embedded", "Pyodide, shared isolate", ["pyodide"], python.pyodide.toolCall.cpuUs),
		]).concat(byValue([
			callRow("process", "Lua", ["lua"], processes.lua.toolCall.cpuUs),
			callRow("process", "LuaJIT", ["luajit"], processes.luajit.toolCall.cpuUs),
			callRow("process", "Node.js", ["nodejs"], processes.node.toolCall.cpuUs),
			callRow("process", "CPython", ["cpython"], processes.python.toolCall.cpuUs),
			callRow("process", "dash", ["dash"], processes.dash.toolCall.cpuUs),
			callRow("process", "bash", ["bash"], processes.bash.toolCall.cpuUs),
			callRow("process", "Deno", ["deno"], processes.deno.toolCall.cpuUs),
			callRow("process", "Bun", ["bun"], processes.bun.toolCall.cpuUs),
			callRow("process", "bash, one command per call", ["bash"], suite.bashCommandPerCall.trueBinary.cpuUs),
		])),
		note: `CPU is user plus system time across the host and, for separate processes, the sandbox process, divided by calls. QuickJS's cost is mostly quickjs-emscripten's handle API; MicroPython's bridge serves only the newest instance in a realm. Bars that end in a break run past the axis. ${environment}`,
	},
];

fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), charts }, null, 2));
console.log(`wrote ${charts.length} charts with ${charts.reduce((sum, chart) => sum + chart.rows.length, 0)} rows to ${outputPath}`);

// The combined image: three panels with the same columns, in the same order, on log axes.
function compactBytes(bytes) {
	if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
	return bytes < 1e7 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e6)} MB`;
}

function compactMs(ms) {
	if (ms < 1) return `${Math.round(ms * 1e3)} µs`;
	if (ms >= 1000) return `${(ms / 1e3).toFixed(1)} s`;
	return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

function compactUs(us) {
	if (us >= 1000) return `${(us / 1e3).toFixed(1)} ms`;
	if (us < 1) return `${us.toFixed(2)} µs`;
	return us < 10 ? `${us.toFixed(1)} µs` : `${Math.round(us)} µs`;
}

const column = (key, group, name, logo, memoryBytes, startMs, toolCallUs) => ({
	key,
	group,
	name,
	logo,
	memory: { value: memoryBytes, label: compactBytes(memoryBytes) },
	start: { value: startMs * 1e3, label: compactMs(startMs) },
	toolCall: toolCallUs === null ? null : { value: toolCallUs, label: compactUs(toolCallUs) },
});

const combined = {
	file: "combined.png",
	title: "Code-mode sandboxes: embedded vs separate process",
	panels: [
		{ key: "memory", title: "Memory per sandbox", unit: "bytes", min: 1e4, max: 1e8, ticks: [[1e4, "10 KB"], [1e5, "100 KB"], [1e6, "1 MB"], [1e7, "10 MB"], [1e8, "100 MB"]] },
		{ key: "start", title: "Time to first response", unit: "µs", min: 10, max: 1e7, ticks: [[10, "10 µs"], [100, "100 µs"], [1e3, "1 ms"], [1e4, "10 ms"], [1e5, "100 ms"], [1e6, "1 s"], [1e7, "10 s"]] },
		{ key: "toolCall", title: "Tool call round trip", unit: "µs", min: 0.1, max: 1e3, ticks: [[0.1, "0.1 µs"], [1, "1 µs"], [10, "10 µs"], [100, "100 µs"], [1e3, "1 ms"]] },
	],
	columns: [
		column("lua-state", "embedded", "Lua", "lua", lua.memoryBytesPerState, lua.startUs / 1e3, lua.toolCallWallUs),
		column("luajit-state", "embedded", "LuaJIT", "luajit", luajit.memoryBytesPerState, luajit.startUs / 1e3, luajit.toolCallWallUs),
		column("quickjs", "embedded", "QuickJS", "quickjs", isolates.quickjsOwnModule.memoryBytesPerSession, isolates.quickjsOwnModule.createMs, callCosts.quickjsOwnModuleAsync.wallUs),
		column("v8", "embedded", "V8", "v8", isolates.v8Isolate.memoryBytesPerSession, isolates.v8Isolate.createMs, opBinding.v8IsolateOpStyle.wallUs),
		column("micropython", "embedded", "µPython", "micropython", python.micropython.memoryBytesPerInstance, python.micropython.startMs, python.micropython.toolCall.wallUs),
		column("pyodide", "embedded", "Pyodide", "pyodide", python.pyodide.memoryBytesPerInstance, python.pyodide.startMs, python.pyodide.toolCall.wallUs),
		column("dash", "process", "dash", "dash", processMemory.dash.bytesPerSandbox, processes.dash.startMs, processes.dash.toolCall.wallUs),
		column("bash", "process", "bash", "bash", processMemory.bash.bytesPerSandbox, processes.bash.startMs, processes.bash.toolCall.wallUs),
		column("lua", "process", "Lua", "lua", processMemory.lua.bytesPerSandbox, processes.lua.startMs, processes.lua.toolCall.wallUs),
		column("luajit", "process", "LuaJIT", "luajit", processMemory.luajit.bytesPerSandbox, processes.luajit.startMs, processes.luajit.toolCall.wallUs),
		column("cpython-fork", "process", "CPython\nfork", "cpython", forkMemory.cgroupBytesPerChild, fork.startMs, null),
		column("cpython", "process", "CPython", "cpython", processMemory.python.bytesPerSandbox, processes.python.startMs, processes.python.toolCall.wallUs),
		column("node", "process", "Node", "nodejs", processMemory.node.bytesPerSandbox, processes.node.startMs, processes.node.toolCall.wallUs),
		column("bun", "process", "Bun", "bun", processMemory.bun.bytesPerSandbox, processes.bun.startMs, processes.bun.toolCall.wallUs),
		column("deno", "process", "Deno", "deno", processMemory.deno.bytesPerSandbox, processes.deno.startMs, processes.deno.toolCall.wallUs),
	],
};

const combinedPath = path.join(path.dirname(outputPath), "combined.json");
fs.writeFileSync(combinedPath, JSON.stringify(combined, null, 2));
console.log(`wrote ${combined.columns.length} columns to ${combinedPath}`);
