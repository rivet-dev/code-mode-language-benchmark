// Process runner for node, deno and bun: loop inside the runtime, timed with performance.now().
import fs from "node:fs";
const [taskPath, dataPath, warm, measured] = process.argv.slice(2);
(0, eval)(fs.readFileSync(taskPath, "utf8"));
const run = globalThis.run;
const text = fs.readFileSync(dataPath, "utf8");
const samples = [];
let first = null, same = true;
for (let i = 0; i < Number(warm) + Number(measured); i++) {
	const t0 = performance.now();
	const out = run(text);
	const ms = performance.now() - t0;
	if (first === null) first = out; else if (out !== first) same = false;
	if (i >= Number(warm)) samples.push(ms);
}
console.log("SAMPLES " + samples.join(","));
console.log("SAME " + same);
console.log("RESULT " + first);
