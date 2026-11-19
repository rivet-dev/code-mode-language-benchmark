// Splits the plotted 30 µs QuickJS tool call into QuickJS's own interpreter cost and the cost
// of quickjs-emscripten's handle API, using the same compile-once module as cpu_bench.mjs.
//
//   fullToolCall: cpu_bench.mjs's quickjsOwnModuleAsync exactly.
//   bareHostCall: the guest calls a host function that returns nothing; one JS-Wasm crossing.
//   guestOnly: the guest builds the call object and awaits an already-resolved reply object made
//              inside QuickJS, with no host crossing: the interpreter's share of a tool call.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const inprocDir = process.env.INPROC_DIR;
const require = createRequire(`${inprocDir}/package.json`);
const { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC } = require("quickjs-emscripten");

const WARMUP_CALLS = 2_000;
const MEASURED_CALLS = 20_000;
const BATCH = 100;

const round = (value, digits = 3) => Number(value.toFixed(digits));

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

async function measure(runBatch) {
	await runBatch(WARMUP_CALLS, 0);
	const cpuStart = process.cpuUsage();
	const batchMeans = [];
	for (let index = 0; index < MEASURED_CALLS / BATCH; index++) {
		const startedAt = process.hrtime.bigint();
		await runBatch(BATCH, WARMUP_CALLS + index * BATCH);
		batchMeans.push(Number(process.hrtime.bigint() - startedAt) / 1e3 / BATCH);
	}
	const cpu = process.cpuUsage(cpuStart);
	return { wallUs: round(median(batchMeans)), cpuUs: round((cpu.user + cpu.system) / MEASURED_CALLS) };
}

const wasmPath = path.join(inprocDir, "node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm");
const wasmModule = await WebAssembly.compile(fs.readFileSync(wasmPath));
const variant = newVariant(RELEASE_SYNC, { wasmModule });

async function newSession() {
	const module = await newQuickJSWASMModuleFromVariant(variant);
	const runtime = module.newRuntime();
	const context = runtime.newContext();
	return { runtime, context };
}

/** Calls the guest's async batch function and drains QuickJS's job queue. */
function batchRunner(runtime, context, settled = []) {
	const batch = context.getProp(context.global, "batch");
	return async (count, firstId) => {
		const countHandle = context.newNumber(count);
		const firstHandle = context.newNumber(firstId);
		const promise = context.unwrapResult(context.callFunction(batch, context.undefined, countHandle, firstHandle));
		countHandle.dispose();
		firstHandle.dispose();
		context.unwrapResult(runtime.executePendingJobs());
		const state = context.getPromiseState(promise);
		promise.dispose();
		for (const deferred of settled.splice(0)) deferred.dispose();
		if (state.type !== "fulfilled") throw new Error(`batch ended ${state.type}`);
	};
}

async function fullToolCall() {
	const { runtime, context } = await newSession();
	const settled = [];
	const host = context.newFunction("host", (callHandle) => {
		const call = context.dump(callHandle);
		const deferred = context.newPromise();
		const reply = context.newObject();
		const id = context.newNumber(call.id);
		const value = context.newNumber(call.args.s.length);
		context.setProp(reply, "id", id);
		context.setProp(reply, "ok", context.true);
		context.setProp(reply, "value", value);
		id.dispose();
		value.dispose();
		deferred.resolve(reply);
		reply.dispose();
		settled.push(deferred);
		return deferred.handle;
	});
	context.setProp(context.global, "host", host);
	host.dispose();
	context.unwrapResult(context.evalCode(`globalThis.batch = async (count, firstId) => {
		for (let id = firstId; id < firstId + count; id++) {
			const reply = await host({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
			if (reply.id !== id) throw new Error("reply mismatch");
		}
	};`)).dispose();
	return measure(batchRunner(runtime, context, settled));
}

async function bareHostCall() {
	const { runtime, context } = await newSession();
	const host = context.newFunction("host", () => undefined);
	context.setProp(context.global, "host", host);
	host.dispose();
	context.unwrapResult(context.evalCode(`globalThis.batch = async (count, firstId) => {
		for (let id = firstId; id < firstId + count; id++) host();
	};`)).dispose();
	return measure(batchRunner(runtime, context));
}

async function guestOnly() {
	const { runtime, context } = await newSession();
	context.unwrapResult(context.evalCode(`
		const answer = (call) => Promise.resolve({ id: call.id, ok: true, value: call.args.s.length });
		globalThis.batch = async (count, firstId) => {
			for (let id = firstId; id < firstId + count; id++) {
				const reply = await answer({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
				if (reply.id !== id) throw new Error("reply mismatch");
			}
		};
	`)).dispose();
	return measure(batchRunner(runtime, context));
}

const loadBefore = os.loadavg()[0];
console.log(JSON.stringify({
	measuredAt: new Date().toISOString(),
	loadBefore: round(loadBefore, 2),
	fullToolCall: await fullToolCall(),
	bareHostCall: await bareHostCall(),
	guestOnly: await guestOnly(),
	loadAfter: round(os.loadavg()[0], 2),
}));
