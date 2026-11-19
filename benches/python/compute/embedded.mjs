// Embedded Python in Node: pyodide and micropython (Wasm). Timed like the JS embedded engines.
import fs from "node:fs";
const [engine, taskPath, dataPath, warm, measured] = process.argv.slice(2);
const source = fs.readFileSync(taskPath, "utf8");
const text = fs.readFileSync(dataPath, "utf8");
let call;
if (engine === "pyodide") {
	const { loadPyodide } = await import("pyodide");
	const py = await loadPyodide();
	py.runPython(source);
	const run = py.globals.get("run");
	call = (input) => run(input);
} else if (engine === "micropython") {
	const { loadMicroPython } = await import("@micropython/micropython-webassembly-pyscript");
	const mp = await loadMicroPython({ heapsize: 256 * 1024 * 1024, stdout: () => {} });
	mp.runPython(source);
	const run = mp.globals.get("run");
	call = (input) => run(input);
}
const samples = [];
let first = null, same = true;
for (let i = 0; i < Number(warm) + Number(measured); i++) {
	const t0 = process.hrtime.bigint();
	const out = call(text);
	const ms = Number(process.hrtime.bigint() - t0) / 1e6;
	if (first === null) first = out; else if (out !== first) same = false;
	if (i >= Number(warm)) samples.push(ms);
}
console.log("SAMPLES " + samples.join(","));
console.log("SAME " + same);
console.log("RESULT " + String(first));
