// Times compiling the same Wasm bytes twice while the first module is alive, to see whether V8's
// native-module cache makes a per-load compile free. Usage: node wasm_compile_check.mjs <file.wasm>...
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ms = (startedAt) => Number(process.hrtime.bigint() - startedAt) / 1e6;
const results = { loadBefore: os.loadavg()[0], files: {} };
const keep = [];
for (const file of process.argv.slice(2)) {
	const bytes = fs.readFileSync(file);
	const timings = [];
	for (let run = 0; run < 3; run++) {
		const copy = Buffer.from(bytes);
		const startedAt = process.hrtime.bigint();
		keep.push(await WebAssembly.compile(copy));
		timings.push(Number(ms(startedAt).toFixed(2)));
	}
	results.files[path.basename(file)] = { megabytes: Number((bytes.length / 1e6).toFixed(2)), compileMs: timings };
}
results.loadAfter = os.loadavg()[0];
console.log(JSON.stringify(results));
