// Pyodide restored from a memory snapshot: time to first response, memory per instance, and
// tool-call round trip, with the same definitions as py_inproc.mjs. Run with --expose-gc.
import os from "node:os";
import { loadPyodide } from "pyodide";

const round = (value, digits = 2) => Number(value.toFixed(digits));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function settledRss() {
	for (let pass = 0; pass < 3; pass++) {
		globalThis.gc();
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return process.memoryUsage().rss;
}

const maker = await loadPyodide({ _makeSnapshot: true });
const snapshot = maker.makeMemorySnapshot();

async function restore() {
	const startedAt = process.hrtime.bigint();
	const instance = await loadPyodide({ _loadSnapshot: snapshot });
	if (instance.runPython("1 + 1") !== 2) throw new Error("wrong answer");
	return { instance, elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6 };
}

const startSamples = [];
for (let run = 0; run < 7; run++) startSamples.push((await restore()).elapsedMs);

const before = await settledRss();
const kept = [];
for (let index = 0; index < 6; index++) kept.push((await restore()).instance);
const after = await settledRss();

const instance = kept[0];
instance.registerJsModule("host", {
	call: async (callProxy) => {
		const call = callProxy.toJs({ dict_converter: Object.fromEntries });
		return { id: call.id, ok: true, value: call.args.s.length };
	},
});
instance.runPython(`
import host

async def batch(first, count):
    for call_id in range(first, first + count):
        reply = await host.call({"id": call_id, "tool": "lookup", "args": {"s": "hello from the sandbox"}})
        if reply.id != call_id:
            raise RuntimeError("reply mismatch")
`);
await instance.runPythonAsync("await batch(0, 2000)");
const batchMeans = [];
const cpuStart = process.cpuUsage();
for (let first = 2000; first < 22000; first += 500) {
	const startedAt = process.hrtime.bigint();
	await instance.runPythonAsync(`await batch(${first}, 500)`);
	batchMeans.push(Number(process.hrtime.bigint() - startedAt) / 1e3 / 500);
}
const cpu = process.cpuUsage(cpuStart);

console.log(JSON.stringify({
	measuredAt: new Date().toISOString(),
	loadAverage: os.loadavg(),
	snapshotBytes: snapshot.byteLength,
	startMs: round(median(startSamples.slice(1))),
	memoryBytesPerInstance: Math.round((after - before) / kept.length),
	toolCall: { wallUs: round(median(batchMeans)), cpuUs: round((cpu.user + cpu.system) / 20000) },
}, null, 2));
