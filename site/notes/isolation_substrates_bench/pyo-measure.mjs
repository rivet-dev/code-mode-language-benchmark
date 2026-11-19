// Measure Pyodide cold load time and resident memory per instance in one Node process.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.argv[2] + '/');
const { loadPyodide } = require('pyodide');
function mem() {
  const s = readFileSync('/proc/self/status', 'utf8');
  const g = (k) => +s.match(new RegExp(k + ':\\s+(\\d+)'))[1];
  return { VmSize: g('VmSize'), VmRSS: g('VmRSS'), RssAnon: g('RssAnon') };
}
const out = { node: process.version, results: [] };
const m0 = mem();
let prev = m0;
const insts = [];
for (let i = 0; i < 4; i++) {
  const t0 = performance.now();
  const py = await loadPyodide();
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  py.runPython('import json, re, math; x = sum(range(1000))');
  const runMs = performance.now() - t1;
  const heapBytes = py._module.HEAP8.length;
  insts.push(py);
  const m = mem();
  out.results.push({ i, version: py.version, loadMs: +loadMs.toFixed(1), firstRunMs: +runMs.toFixed(1), linearMemMiB: +(heapBytes / 1048576).toFixed(1),
    dRSS_MiB: +((m.VmRSS - prev.VmRSS) / 1024).toFixed(1), dAnon_MiB: +((m.RssAnon - prev.RssAnon) / 1024).toFixed(1), dVmSize_GiB: +((m.VmSize - prev.VmSize) / 1048576).toFixed(2) });
  prev = m;
}
out.baseline_before_first = { RSS_MiB: +(m0.VmRSS / 1024).toFixed(1), Anon_MiB: +(m0.RssAnon / 1024).toFixed(1) };
console.log(JSON.stringify(out, null, 1));
