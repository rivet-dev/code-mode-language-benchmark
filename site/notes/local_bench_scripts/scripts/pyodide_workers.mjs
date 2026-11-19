// Usage: node --expose-gc pyodide_workers.mjs <pyodide dir> <cacheDir> <N>
// Measures marginal RSS per worker_thread that loads its own Pyodide instance (separate V8 isolate).
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
const [dir, cacheDir, nStr] = process.argv.slice(2);
const N = Number(nStr);
const mb = () => process.memoryUsage().rss / 1048576;
const settle = async () => { for (let i = 0; i < 3; i++) { if (global.gc) global.gc(); await new Promise((r) => setTimeout(r, 100)); } };
const src = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { loadPyodide } = await import(workerData.url);
  const t = performance.now();
  const py = await loadPyodide({ packageCacheDir: workerData.cacheDir, indexURL: workerData.indexURL });
  py.runPython("import json, re, datetime");
  parentPort.postMessage(performance.now() - t);
  setInterval(() => {}, 1 << 30);
})();`;
await settle();
const r0 = mb();
// Empty workers first, to separate isolate cost from Pyodide cost.
const empties = [];
for (let i = 0; i < N; i++) { const w = new Worker("require('node:worker_threads').parentPort.postMessage(1); setInterval(()=>{}, 1<<30)", { eval: true }); await new Promise((r) => w.once("message", r)); empties.push(w); }
await settle();
const r1 = mb();
const url = pathToFileURL(`${dir}/node_modules/pyodide/pyodide.mjs`).href;
const times = [];
const ws = [];
for (let i = 0; i < N; i++) { const w = new Worker(src, { eval: true, workerData: { url, cacheDir, indexURL: `${dir}/node_modules/pyodide/` } }); times.push(await new Promise((r) => w.once("message", r))); ws.push(w); }
await settle();
const r2 = mb();
console.log(JSON.stringify({ node: process.version, N, emptyWorkerRssMB: (r1 - r0) / N, pyodideWorkerRssMB: (r2 - r1) / N, avgWorkerPyodideLoadMs: times.reduce((a, b) => a + b, 0) / N }));
process.exit(0);
