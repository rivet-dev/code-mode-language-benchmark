// Measures an async tool call into a V8 isolate with a same-thread, op-style binding.
//
// The guest starts a tool with a sync host call and awaits a promise; the host answers by
// calling a guest resolver synchronously. This mirrors how deno_core ops resolve promises on
// the isolate's own thread, unlike isolated-vm's async API, which hops between threads.
import { createRequire } from "node:module";
import os from "node:os";

const require = createRequire(import.meta.url);
const ivm = require("isolated-vm");

const WARMUP_CALLS = 2_000;
const MEASURED_CALLS = 20_000;
const BATCH = 100;

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

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
`);
const startBatch = context.global.getSync("startBatch", { reference: true });
const finish = context.global.getSync("finish", { reference: true });

function runBatch(count, firstId) {
	startBatch.applySync(undefined, [count, firstId]);
	while (started.length > 0) {
		const call = started.shift();
		const reply = { id: call.id, ok: true, value: call.args.s.length };
		finish.applySync(undefined, [call.id, reply], { arguments: { copy: true } });
	}
	if (context.global.getSync("batchDone") !== true) throw new Error("batch did not finish");
}

runBatch(WARMUP_CALLS, 0);
const cpuStart = process.cpuUsage();
const batchMeans = [];
for (let index = 0; index < MEASURED_CALLS / BATCH; index++) {
	const startedAt = process.hrtime.bigint();
	runBatch(BATCH, WARMUP_CALLS + index * BATCH);
	batchMeans.push(Number(process.hrtime.bigint() - startedAt) / 1e3 / BATCH);
}
const cpu = process.cpuUsage(cpuStart);
isolate.dispose();

console.log(JSON.stringify({
	measuredAt: new Date().toISOString(),
	loadAverage: os.loadavg(),
	v8IsolateOpStyle: {
		wallUs: Number(median(batchMeans).toFixed(2)),
		cpuUs: Number(((cpu.user + cpu.system) / MEASURED_CALLS).toFixed(2)),
	},
}, null, 2));
