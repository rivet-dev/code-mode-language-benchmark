// Splits the plotted 7.7 µs "V8 same-thread binding" tool call into V8's own cost and
// isolated-vm's cross-isolate cost.
//
//   opStyleCopy: v8_op.mjs exactly (two applySync crossings per call, objects copied each way).
//   opStylePrimitives: the same two crossings, passing only numbers so nothing is copied.
//   bareApplySync: one guest-to-host applySync with no arguments, the floor of one crossing.
//   sameIsolateVm: a node:vm context in the host isolate; the guest awaits a host function that
//                  resolves a promise at once. Not a security boundary; it is the cost of the V8
//                  work itself (call, promise, microtask) that a native embedder would pay.
import { createRequire } from "node:module";
import os from "node:os";
import vm from "node:vm";

// isolated-vm is installed in the original inproc folder; resolve it from there.
const require = createRequire(`${process.env.INPROC_DIR}/package.json`);
const ivm = require("isolated-vm");

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

const GUEST_LOOP = `
	globalThis.startBatch = (count, firstId) => {
		globalThis.batchDone = false;
		(async () => {
			for (let id = firstId; id < firstId + count; id++) {
				const reply = await callTool({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
				if (reply.id !== id) throw new Error("reply mismatch");
			}
			globalThis.batchDone = true;
		})();
	};
`;

/** v8_op.mjs as written: the call and the reply cross as copied objects. */
async function opStyleCopy() {
	const isolate = new ivm.Isolate({ memoryLimit: 128 });
	const context = isolate.createContextSync();
	const started = [];
	context.global.setSync("startRef", new ivm.Reference((call) => {
		started.push(call);
	}));
	context.evalSync(`
		const pending = new Map();
		globalThis.finish = (id, reply) => {
			const resolve = pending.get(id);
			pending.delete(id);
			resolve(reply);
		};
		const callTool = (call) => new Promise((resolve) => {
			pending.set(call.id, resolve);
			startRef.applySync(undefined, [call], { arguments: { copy: true } });
		});
		${GUEST_LOOP}
	`);
	const startBatch = context.global.getSync("startBatch", { reference: true });
	const finish = context.global.getSync("finish", { reference: true });
	const result = await measure((count, firstId) => {
		startBatch.applySync(undefined, [count, firstId]);
		while (started.length > 0) {
			const call = started.shift();
			finish.applySync(undefined, [call.id, { id: call.id, ok: true, value: call.args.s.length }], { arguments: { copy: true } });
		}
		if (context.global.getSync("batchDone") !== true) throw new Error("batch did not finish");
	});
	isolate.dispose();
	return result;
}

/** The same two crossings per call, with only numbers crossing. */
async function opStylePrimitives() {
	const isolate = new ivm.Isolate({ memoryLimit: 128 });
	const context = isolate.createContextSync();
	const started = [];
	context.global.setSync("startRef", new ivm.Reference((id, length) => {
		started.push([id, length]);
	}));
	context.evalSync(`
		const pending = new Map();
		globalThis.finish = (id, value) => {
			const resolve = pending.get(id);
			pending.delete(id);
			resolve({ id, ok: true, value });
		};
		const callTool = (call) => new Promise((resolve) => {
			pending.set(call.id, resolve);
			startRef.applySync(undefined, [call.id, call.args.s.length]);
		});
		${GUEST_LOOP}
	`);
	const startBatch = context.global.getSync("startBatch", { reference: true });
	const finish = context.global.getSync("finish", { reference: true });
	const result = await measure((count, firstId) => {
		startBatch.applySync(undefined, [count, firstId]);
		while (started.length > 0) {
			const [id, length] = started.shift();
			finish.applySync(undefined, [id, length]);
		}
		if (context.global.getSync("batchDone") !== true) throw new Error("batch did not finish");
	});
	isolate.dispose();
	return result;
}

async function bareApplySync() {
	const isolate = new ivm.Isolate({ memoryLimit: 128 });
	const context = isolate.createContextSync();
	context.global.setSync("noopRef", new ivm.Reference(() => undefined));
	context.evalSync(`globalThis.loop = (count) => { for (let index = 0; index < count; index++) noopRef.applySync(undefined, []); };`);
	const loop = context.global.getSync("loop", { reference: true });
	const result = await measure((count) => loop.applySync(undefined, [count]));
	isolate.dispose();
	return result;
}

async function sameIsolateVm() {
	const context = vm.createContext({
		hostCall: (call) => Promise.resolve({ id: call.id, ok: true, value: call.args.s.length }),
	});
	vm.runInContext(`
		globalThis.batch = async (count, firstId) => {
			for (let id = firstId; id < firstId + count; id++) {
				const reply = await hostCall({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
				if (reply.id !== id) throw new Error("reply mismatch");
			}
		};
	`, context);
	return measure((count, firstId) => context.batch(count, firstId));
}

const loadBefore = os.loadavg()[0];
console.log(JSON.stringify({
	measuredAt: new Date().toISOString(),
	loadBefore: round(loadBefore, 2),
	opStyleCopy: await opStyleCopy(),
	opStylePrimitives: await opStylePrimitives(),
	bareApplySync: await bareApplySync(),
	sameIsolateVm: await sameIsolateVm(),
	loadAfter: round(os.loadavg()[0], 2),
}));
