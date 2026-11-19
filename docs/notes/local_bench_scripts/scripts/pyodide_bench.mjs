// Usage: node --expose-gc pyodide_bench.mjs <dir containing node_modules/pyodide> <packageCacheDir>
// Measures Pyodide load time, marginal RSS per instance, package load cost,
// host-call overhead (sync and async), many concurrent awaits, and memory snapshots.
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
const cacheDir = process.argv[3];
const { loadPyodide, version } = await import(pathToFileURL(`${dir}/node_modules/pyodide/pyodide.mjs`).href);

const mb = () => process.memoryUsage().rss / 1048576;
const settle = async () => {
	for (let i = 0; i < 3; i++) {
		if (global.gc) global.gc();
		await new Promise((r) => setTimeout(r, 50));
	}
};
const now = () => performance.now();
const out = { node: process.version, pyodide: version, execArgv: process.execArgv };

await settle();
out.baselineRssMB = mb();

let t = now();
const py = await loadPyodide({ packageCacheDir: cacheDir });
out.firstLoadMs = now() - t;
await settle();
out.rssAfterFirstMB = mb();

t = now();
const py2 = await loadPyodide({ packageCacheDir: cacheDir });
out.secondLoadMs = now() - t;
await settle();
out.rssAfterSecondMB = mb();

const extra = [];
t = now();
for (let i = 0; i < 8; i++) extra.push(await loadPyodide({ packageCacheDir: cacheDir }));
out.avgLoadMsNext8 = (now() - t) / 8;
await settle();
out.rssAfter10MB = mb();
out.marginalRssPerInstanceMB = (out.rssAfter10MB - out.rssAfterSecondMB) / 8;
// Touch every instance so none are collected.
out.extraCheck = extra.map((p) => p.runPython("1+1")).reduce((a, b) => a + b, 0);

// Pure-Python speed.
t = now();
py.runPython("def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\nfib(25)");
out.fib25Ms = now() - t;
t = now();
py.runPython("s = 0\nfor i in range(1000000):\n    s += i * i");
out.loop1e6Ms = now() - t;

// Sync host call overhead.
py.globals.set("hostf", (x) => x + 1);
t = now();
py.runPython("for i in range(100000):\n    hostf(i)");
out.syncHostCallUs = ((now() - t) * 1000) / 100000;

// Async host call overhead (serial awaits of an already-resolved promise).
py.globals.set("ahost", async (x) => x + 1);
t = now();
await py.runPythonAsync("for i in range(10000):\n    await ahost(i)");
out.asyncHostCallUs = ((now() - t) * 1000) / 10000;

// 1000 concurrent slow host calls (100 ms each) via asyncio.gather.
py.globals.set("aslow", (x) => new Promise((r) => setTimeout(() => r(x), 100)));
await settle();
const rssBeforeGather = mb();
t = now();
await py.runPythonAsync("import asyncio\nr = await asyncio.gather(*[aslow(i) for i in range(1000)])\nlen(r)");
out.gather1000x100msMs = now() - t;
await settle();
out.gatherRssDeltaMB = mb() - rssBeforeGather;

// JSPI availability (run_sync).
out.canRunSync = await py.runPythonAsync("from pyodide.ffi import can_run_sync\ncan_run_sync()");

// Package load cost (from local cache after the first run).
await settle();
let r = mb();
t = now();
await py.loadPackage("numpy");
out.numpyLoadPackageMs = now() - t;
t = now();
py.runPython("import numpy");
out.numpyImportMs = now() - t;
await settle();
out.numpyRssDeltaMB = mb() - r;

r = mb();
t = now();
await py.loadPackage("pandas");
out.pandasLoadPackageMs = now() - t;
t = now();
py.runPython("import pandas");
out.pandasImportMs = now() - t;
await settle();
out.pandasRssDeltaMB = mb() - r;

r = mb();
t = now();
await py.loadPackage("matplotlib");
out.matplotlibLoadPackageMs = now() - t;
t = now();
py.runPython("import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nplt.plot([1,2,3]); plt.savefig('x.png')");
out.matplotlibImportAndPlotMs = now() - t;
await settle();
out.matplotlibRssDeltaMB = mb() - r;

// Memory snapshot: make one after importing json/re/datetime, then restore 5 instances.
try {
	t = now();
	const ps = await loadPyodide({ packageCacheDir: cacheDir, _makeSnapshot: true });
	ps.runPython("import json, re, datetime, asyncio");
	const snap = ps.makeMemorySnapshot();
	out.snapshotMakeMs = now() - t;
	out.snapshotBytesMB = snap.byteLength / 1048576;
	await settle();
	r = mb();
	const restored = [];
	t = now();
	for (let i = 0; i < 5; i++) restored.push(await loadPyodide({ packageCacheDir: cacheDir, _loadSnapshot: snap }));
	out.snapshotRestoreAvgMs = (now() - t) / 5;
	await settle();
	out.snapshotRestoreMarginalRssMB = (mb() - r) / 5;
	out.snapshotRestoreCheck = restored[0].runPython("import json; json.dumps({'a': 1})");
} catch (e) {
	out.snapshotError = String(e).slice(0, 300);
}

out.py2Check = py2.runPython("2+2");
console.log(JSON.stringify(out, null, 1));
process.exit(0);
