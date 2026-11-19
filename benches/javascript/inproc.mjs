// Measures in-process sandboxes with the same JSON tool call the process suite sends across processes.
//
// Run with: node --expose-gc inproc.mjs
// V8 isolate: isolated-vm 6.2, one isolate plus context per session.
// QuickJS: quickjs-emscripten 0.32 sync build, one Wasm module (its own linear memory) per
// session, instantiated from a WebAssembly.Module compiled once.
// A tool call is an async host function that answers on a later event-loop turn.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC } from "quickjs-emscripten";

const require = createRequire(import.meta.url);
const ivm = require("isolated-vm");

const CREATE_RUNS = 40;
const MEMORY_SESSIONS = { v8: 200, quickjs: 100 };
const CALL_BATCHES = 200;
const CALLS_PER_BATCH = 100;
const QUICKJS_CALLS = 22_000;
const QUICKJS_WARMUP = 2_000;

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

function round(value, digits = 2) {
	return Number(value.toFixed(digits));
}

function settledRss() {
	globalThis.gc();
	globalThis.gc();
	return process.memoryUsage().rss;
}

async function measureV8() {
	// Create time: isolate, context, and a first evaluation.
	const createSamples = [];
	for (let run = 0; run < CREATE_RUNS + 3; run++) {
		const startedAt = process.hrtime.bigint();
		const isolate = new ivm.Isolate({ memoryLimit: 128 });
		const context = isolate.createContextSync();
		context.evalSync("1 + 1");
		const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
		if (run >= 3) createSamples.push(elapsedMs);
		context.release();
		isolate.dispose();
	}

	// Memory: resident growth per live session across many sessions.
	const before = settledRss();
	const live = [];
	for (let index = 0; index < MEMORY_SESSIONS.v8; index++) {
		const isolate = new ivm.Isolate({ memoryLimit: 128 });
		const context = isolate.createContextSync();
		context.evalSync("1 + 1");
		live.push([isolate, context]);
	}
	const after = settledRss();
	for (const [isolate, context] of live) {
		context.release();
		isolate.dispose();
	}

	// Tool call: the guest awaits an async host function in a loop; time whole batches.
	const isolate = new ivm.Isolate({ memoryLimit: 128 });
	const context = await isolate.createContext();
	const host = new ivm.Reference(async (call) => {
		await nextTurn();
		return { id: call.id, ok: true, value: call.args.s.length };
	});
	await context.global.set("hostRef", host);
	await context.eval(`
		globalThis.batch = async (count, firstId) => {
			for (let id = firstId; id < firstId + count; id++) {
				const reply = await hostRef.apply(
					undefined,
					[{ id, tool: "lookup", args: { s: "hello from the sandbox" } }],
					{ arguments: { copy: true }, result: { promise: true, copy: true } },
				);
				if (reply.id !== id) throw new Error("reply mismatch");
			}
			return count;
		};
	`);
	const batch = await context.global.get("batch", { reference: true });
	const perCallSamples = [];
	for (let index = 0; index < CALL_BATCHES + 10; index++) {
		const startedAt = process.hrtime.bigint();
		await batch.apply(undefined, [CALLS_PER_BATCH, index * CALLS_PER_BATCH], { result: { promise: true } });
		const elapsedUs = Number(process.hrtime.bigint() - startedAt) / 1e3;
		if (index >= 10) perCallSamples.push(elapsedUs / CALLS_PER_BATCH);
	}
	isolate.dispose();

	return {
		createMs: round(median(createSamples)),
		memoryBytesPerSession: Math.round((after - before) / MEMORY_SESSIONS.v8),
		toolCallUs: round(median(perCallSamples)),
	};
}

/** Creates one QuickJS session in its own Wasm module and runs a first evaluation. */
async function newQuickJSSession(variant) {
	const module = await newQuickJSWASMModuleFromVariant(variant);
	const runtime = module.newRuntime();
	runtime.setMemoryLimit(64 << 20);
	const context = runtime.newContext();
	context.unwrapResult(context.evalCode("1 + 1")).dispose();
	return { module, runtime, context };
}

async function measureQuickJS() {
	const wasmPath = require.resolve("@jitl/quickjs-wasmfile-release-sync/wasm");
	const compileStartedAt = process.hrtime.bigint();
	const wasmModule = await WebAssembly.compile(fs.readFileSync(wasmPath));
	const compileMs = Number(process.hrtime.bigint() - compileStartedAt) / 1e6;
	const variant = newVariant(RELEASE_SYNC, { wasmModule });

	// Create time: instantiate the precompiled module, then runtime, context, first evaluation.
	const createSamples = [];
	for (let run = 0; run < CREATE_RUNS + 3; run++) {
		const startedAt = process.hrtime.bigint();
		const session = await newQuickJSSession(variant);
		const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
		if (run >= 3) createSamples.push(elapsedMs);
		session.context.dispose();
		session.runtime.dispose();
	}

	// Memory: resident growth per live session, each with its own module and linear memory.
	const before = settledRss();
	const live = [];
	for (let index = 0; index < MEMORY_SESSIONS.quickjs; index++) live.push(await newQuickJSSession(variant));
	const after = settledRss();
	for (const session of live) {
		session.context.dispose();
		session.runtime.dispose();
	}

	// Tool call: time from one host call to the next, with a reply on a later event-loop turn.
	const { runtime, context } = await newQuickJSSession(variant);
	let pending = null;
	const issuedAt = [];
	const host = context.newFunction("host", (callHandle) => {
		issuedAt.push(process.hrtime.bigint());
		const deferred = context.newPromise();
		pending = { deferred, call: context.dump(callHandle) };
		return deferred.handle;
	});
	context.setProp(context.global, "host", host);
	host.dispose();
	context.unwrapResult(context.evalCode(`
		(async () => {
			for (let id = 0; id < ${QUICKJS_CALLS}; id++) {
				const reply = await host({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
				if (reply.id !== id) throw new Error("reply mismatch");
			}
		})();
	`)).dispose();

	while (pending) {
		const { deferred, call } = pending;
		pending = null;
		await nextTurn();
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
		deferred.dispose();
		runtime.executePendingJobs();
	}

	const perCallSamples = [];
	for (let index = QUICKJS_WARMUP + 1; index < issuedAt.length; index++) {
		perCallSamples.push(Number(issuedAt[index] - issuedAt[index - 1]) / 1e3);
	}
	context.dispose();
	runtime.dispose();

	return {
		compileOnceMs: round(compileMs),
		createMs: round(median(createSamples)),
		memoryBytesPerSession: Math.round((after - before) / MEMORY_SESSIONS.quickjs),
		toolCallUs: round(median(perCallSamples)),
		calls: perCallSamples.length,
	};
}

const results = {
	measuredAt: new Date().toISOString(),
	loadAverage: os.loadavg(),
	node: process.version,
	v8Isolate: await measureV8(),
	quickjsOwnModule: await measureQuickJS(),
};

console.log(JSON.stringify(results, null, 2));
