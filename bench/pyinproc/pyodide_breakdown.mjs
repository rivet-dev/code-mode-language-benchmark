// Splits Pyodide's time to first response into Wasm compile and interpreter startup, and
// compares a fresh load with a snapshot restore, recording load average for each run.
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { loadPyodide } from "pyodide";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("pyodide/pyodide.asm.wasm");
const ms = (startedAt) => Number(process.hrtime.bigint() - startedAt) / 1e6;
const load = () => os.loadavg()[0].toFixed(1);

const bytes = fs.readFileSync(wasmPath);
for (let run = 1; run <= 2; run++) {
	const startedAt = process.hrtime.bigint();
	await WebAssembly.compile(bytes);
	console.log(`wasm compile ${run} (${(bytes.length / 1e6).toFixed(1)} MB): ${ms(startedAt).toFixed(0)} ms, load ${load()}`);
}

for (let run = 1; run <= 4; run++) {
	const startedAt = process.hrtime.bigint();
	const py = await loadPyodide();
	const loadedMs = ms(startedAt);
	const answer = py.runPython("1 + 1");
	console.log(`fresh load ${run}: loadPyodide ${loadedMs.toFixed(0)} ms, first response at ${ms(startedAt).toFixed(0)} ms (answer ${answer}), load ${load()}`);
}

const maker = await loadPyodide({ _makeSnapshot: true });
const snapshot = maker.makeMemorySnapshot();
console.log(`snapshot size: ${(snapshot.byteLength / 1e6).toFixed(1)} MB`);
for (let run = 1; run <= 3; run++) {
	const startedAt = process.hrtime.bigint();
	const py = await loadPyodide({ _loadSnapshot: snapshot });
	const answer = py.runPython("1 + 1");
	console.log(`snapshot restore ${run}: first response at ${ms(startedAt).toFixed(0)} ms (answer ${answer}), load ${load()}`);
}
