// Runs each runtime once, sequentially, validates its result checksum and writes results.json.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
const C = new URL(".", import.meta.url).pathname;
const WARM = 2, MEASURED = 7;
const meta = JSON.parse(fs.readFileSync(C + "data/meta.json", "utf8"));
const data = C + "data/orders.json";
const T = (name) => C + "tasks/" + name;
const JSONLUA = C + "vendor/rxi-json-lua/json.lua";
const SHIM55 = C + "vendor/cjson_shim_5.5.lua";
const SHIMJIT = C + "vendor/cjson_shim_luajit.lua";
const ver = (cmd, args) => { try { return spawnSync(cmd, args, { encoding: "utf8" }).stdout.trim().split("\n")[0] + spawnSync(cmd, args, { encoding: "utf8" }).stderr.trim().split("\n")[0]; } catch { return "unknown"; } };
const N = [String(WARM), String(MEASURED)];
const RUNTIMES = [
	{ key: "quickjs", label: "QuickJS (Wasm)", group: "embedded", host: "Node 22.23.1 + quickjs-emscripten 0.32.0 (RELEASE_SYNC variant, one Wasm module)", version: "quickjs-emscripten 0.32.0", cmd: ["node", [C + "hosts/js_embedded/run.mjs", "quickjs", T("task.js"), data, ...N]], notes: ["Interpreter only (QuickJS has no JIT). No memory limit or interrupt handler set."] },
	{ key: "v8", label: "V8 isolate", group: "embedded", host: "Node 22.23.1 + isolated-vm 6.2.0 (applySync)", version: "V8 12.4.254.21-node.56 via isolated-vm 6.2.0", cmd: ["node", [C + "hosts/js_embedded/run.mjs", "v8", T("task.js"), data, ...N]], notes: ["Default V8 tiers (Ignition, Sparkplug, Maglev, TurboFan). memoryLimit 1024 MB."] },
	{ key: "pyodide", label: "Pyodide", group: "embedded", host: "Node 22.23.1 + pyodide 314.0.8", version: "pyodide 314.0.8", cmd: ["node", [C + "hosts/py_embedded/run.mjs", "pyodide", T("task.py"), data, ...N]], notes: ["CPython interpreter compiled to Wasm (no JIT); json uses its C accelerator. String converted JS to Python and back by Pyodide's automatic conversion."] },
	{ key: "micropython", label: "MicroPython (Wasm)", group: "embedded", host: "Node 22.23.1 + @micropython/micropython-webassembly-pyscript 1.29.0-6", version: "MicroPython 1.29.0-6 (webassembly port)", cmd: ["node", [C + "hosts/py_embedded/run.mjs", "micropython", T("task.py"), data, ...N]], notes: ["Interpreter only. heapsize raised to 256 MiB (the default cannot hold the parsed dataset); json is MicroPython's built-in C module."] },
	{ key: "node", label: "Node", group: "process", host: "separate process, loop timed inside with performance.now()", version: "Node " + process.version.slice(1), cmd: ["node", [C + "hosts/proc/run_js.mjs", T("task.js"), data, ...N]], notes: ["Default V8 JIT tiers."] },
	{ key: "deno", label: "Deno", group: "process", host: "separate process, loop timed inside with performance.now()", version: ver("deno", ["--version"]), cmd: ["deno", ["run", "--quiet", "--allow-read", C + "hosts/proc/run_js.mjs", T("task.js"), data, ...N]], notes: ["Default V8 JIT tiers."] },
	{ key: "bun", label: "Bun", group: "process", host: "separate process, loop timed inside with performance.now()", version: "Bun " + ver("bun", ["--version"]), cmd: ["bun", [C + "hosts/proc/run_js.mjs", T("task.js"), data, ...N]], notes: ["Default JavaScriptCore JIT tiers."] },
	{ key: "cpython", label: "CPython", group: "process", host: "separate process, loop timed inside with time.perf_counter_ns()", version: ver("python3", ["--version"]), cmd: ["python3", ["-I", C + "hosts/proc/run_py.py", T("task.py"), data, ...N]], notes: ["Default interpreter settings (no experimental JIT flag); json uses the C accelerator."] },
	{ key: "lua-cjson", label: "Lua + lua-cjson", group: "process", host: "separate process, loop timed inside with os.clock()", version: "Lua 5.5.1", cmd: ["lua", [C + "hosts/proc/run_lua.lua", T("task.lua"), data, SHIM55, ...N]], notes: ["Interpreter only. JSON via vendored pure-Lua rxi/json.lua (MIT). Timed with os.clock(), which is process CPU time: standard Lua has no sub-second wall clock."] },
	{ key: "luajit-cjson", label: "LuaJIT + lua-cjson", group: "process", host: "separate process, loop timed inside with os.clock()", version: "LuaJIT 2.1.1794214635", cmd: ["luajit", [C + "hosts/proc/run_lua.lua", T("task.lua"), data, SHIMJIT, ...N]], notes: ["JIT on (default). JSON via vendored pure-Lua rxi/json.lua (MIT). Timed with os.clock(), process CPU time."] },
];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function canonical(resultText) {
	const r = JSON.parse(resultText);
	return JSON.stringify({
		revenueByRegion: Object.fromEntries(Object.keys(r.revenueByRegion).sort().map((k) => [k, Math.round(r.revenueByRegion[k] * 100)])),
		topCustomers: r.topCustomers.map((e) => [e.customer, Math.round(e.revenue * 100)]),
		ordersWithMoreThan3Items: r.ordersWithMoreThan3Items,
	});
}
const median = (s) => { const a = [...s].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const p90 = (s) => { const a = [...s].sort((x, y) => x - y); return a[Math.ceil(0.9 * a.length) - 1]; };
const r3 = (x) => Math.round(x * 1000) / 1000;
const only = process.argv.slice(2);
const entries = [], notApplicable = [];
for (const rt of RUNTIMES) {
	if (only.length && !only.includes(rt.key)) continue;
	const before = os.loadavg().map((x) => Math.round(x * 100) / 100);
	const proc = spawnSync(rt.cmd[0], rt.cmd[1], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 600000 });
	const after = os.loadavg().map((x) => Math.round(x * 100) / 100);
	fs.writeFileSync(C + `results/${rt.key}.raw.txt`, (proc.stdout || "") + "\n--- stderr ---\n" + (proc.stderr || "") + `\n--- status ${proc.status} ${proc.error || ""}`);
	const line = (tag) => (proc.stdout || "").split("\n").find((l) => l.startsWith(tag + " "))?.slice(tag.length + 1);
	try {
		if (proc.status !== 0) throw new Error(`exit ${proc.status}: ${(proc.stderr || "").trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`);
		const samples = line("SAMPLES").split(",").map(Number);
		const checksum = sha(canonical(line("RESULT")));
		const ok = checksum === meta.expectedChecksum && line("SAME") === "true";
		const entry = { key: rt.key, label: rt.label, group: rt.group, host: rt.host, version: rt.version, medianMs: r3(median(samples)), p90Ms: r3(p90(samples)), runs: samples.length, warmupRuns: WARM, resultChecksumOk: ok, resultChecksum: checksum, allRunsIdentical: line("SAME") === "true", loadAverage: { start: before, end: after }, samplesMs: samples.map(r3), notes: rt.notes };
		if (!ok) throw Object.assign(new Error(`checksum mismatch (${checksum})`), { entry });
		entries.push(entry);
		console.error(`${rt.key}: median ${entry.medianMs} ms, p90 ${entry.p90Ms} ms, ok`);
	} catch (error) {
		notApplicable.push({ key: rt.key, label: rt.label, reason: `harness failed on first try: ${error.message}` });
		console.error(`${rt.key}: FAILED ${error.message}`);
	}
}
fs.writeFileSync(C + `results/run-${only.join("-") || "all"}.json`, JSON.stringify({ entries, notApplicable }, null, 2));
const cpu = os.cpus()[0].model;
const out = {
	measuredAt: new Date().toISOString(),
	cpu: { model: cpu, logicalCores: os.cpus().length },
	dataset: { records: meta.records, bytes: meta.bytes, sha256: meta.sha256, seed: meta.seed, generator: "gen_data.mjs (mulberry32)", expectedResultChecksum: meta.expectedChecksum },
	method: {
		timed: "host wall time around one call that passes the JSON string in and gets the result string back (embedded); for processes, the loop runs inside the runtime and is timed with its own clock",
		warmupRuns: WARM, measuredRuns: MEASURED, median: "middle value (mean of the two middle for even counts)", p90: "nearest rank",
		checksum: "sha256 of a canonical form of the returned JSON (sorted region keys, revenues as integer cents, top-5 order kept), compared against an exact integer-cents reference",
		loadPolicy: "deadline-cut run: did not wait for the load to drop; 1/5/15-minute load average recorded at each runtime's start and end",
	},
	entries,
	notApplicable,
};
if (!only.length) fs.writeFileSync(C + "results.json", JSON.stringify(out, null, 2));
