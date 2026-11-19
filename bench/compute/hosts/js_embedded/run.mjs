// Embedded JS engines in Node: quickjs (quickjs-emscripten, one Wasm module) and v8 (isolated-vm).
// Timed: host wall time around one call that passes the JSON string in and gets the result string back.
import fs from "node:fs";
import ivm from "isolated-vm";
import { getQuickJS } from "quickjs-emscripten";
const [engine, taskPath, dataPath, warm, measured] = process.argv.slice(2);
const source = fs.readFileSync(taskPath, "utf8");
const text = fs.readFileSync(dataPath, "utf8");
let call;
if (engine === "quickjs") {
	const QuickJS = await getQuickJS();
	const runtime = QuickJS.newRuntime();
	const context = runtime.newContext();
	context.unwrapResult(context.evalCode(source + "\nglobalThis.run = run;")).dispose();
	const runHandle = context.getProp(context.global, "run");
	call = (input) => {
		const arg = context.newString(input);
		const result = context.callFunction(runHandle, context.undefined, arg);
		arg.dispose();
		const handle = context.unwrapResult(result);
		const out = context.getString(handle);
		handle.dispose();
		return out;
	};
} else if (engine === "v8") {
	const isolate = new ivm.Isolate({ memoryLimit: 1024 });
	const context = isolate.createContextSync();
	context.evalSync(source + "\nglobalThis.run = run;");
	const runRef = context.global.getSync("run", { reference: true });
	call = (input) => runRef.applySync(undefined, [input], { result: { copy: true } });
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
console.log("RESULT " + first);
