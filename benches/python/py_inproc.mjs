// Pyodide and MicroPython embedded in Node, measured with the shared definitions:
//   start: load until the host reads the result of 1 + 1;
//   memory: resident growth per extra instance in the shared isolate, after its first response;
//   tool call: Python awaits an async host function and the host answers at once.
// Run with: node --expose-gc py_inproc.mjs
import os from "node:os";
import { loadPyodide } from "pyodide";
import { loadMicroPython } from "@micropython/micropython-webassembly-pyscript";

const printError = (label) => (error) => {
	console.error(label, String(error?.stack ?? error).slice(0, 600));
	process.exit(1);
};
process.on("uncaughtException", printError("uncaught exception:"));
process.on("unhandledRejection", printError("unhandled rejection:"));

const CALLS = 20_000;
const WARMUP = 2_000;
const BATCH = 500;

const round = (value, digits = 2) => Number(value.toFixed(digits));
const cpuMicros = (usage) => usage.user + usage.system;

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

async function settledRss() {
	for (let pass = 0; pass < 3; pass++) {
		globalThis.gc();
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return process.memoryUsage().rss;
}

const GUEST = `
import host

async def batch(first, count):
    for call_id in range(first, first + count):
        reply = await host.call({"id": call_id, "tool": "lookup", "args": {"s": "hello from the sandbox"}})
        if reply.id != call_id:
            raise RuntimeError("reply mismatch")
`;

/** Runs the guest's tool-call loop in batches and returns wall and CPU per call. */
async function measureToolCalls(runAsync) {
	await runAsync(`await batch(0, ${WARMUP})`);
	const batchMeansUs = [];
	const cpuStart = process.cpuUsage();
	for (let first = WARMUP; first < WARMUP + CALLS; first += BATCH) {
		const startedAt = process.hrtime.bigint();
		await runAsync(`await batch(${first}, ${BATCH})`);
		batchMeansUs.push(Number(process.hrtime.bigint() - startedAt) / 1e3 / BATCH);
	}
	return { wallUs: round(median(batchMeansUs)), cpuUs: round(cpuMicros(process.cpuUsage(cpuStart)) / CALLS) };
}

async function measurePyodide() {
	const firstResponse = async (options = {}) => {
		const startedAt = process.hrtime.bigint();
		const instance = await loadPyodide(options);
		const answer = instance.runPython("1 + 1");
		const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
		if (answer !== 2) throw new Error(`pyodide answered ${answer}`);
		return { instance, elapsedMs };
	};

	const startSamples = [];
	for (let run = 0; run < 6; run++) startSamples.push((await firstResponse()).elapsedMs);

	const maker = await loadPyodide({ _makeSnapshot: true });
	const snapshot = maker.makeMemorySnapshot();
	const snapshotSamples = [];
	for (let run = 0; run < 6; run++) snapshotSamples.push((await firstResponse({ _loadSnapshot: snapshot })).elapsedMs);

	const before = await settledRss();
	const kept = [];
	for (let index = 0; index < 4; index++) kept.push((await firstResponse()).instance);
	const after = await settledRss();

	const instance = kept[0];
	instance.registerJsModule("host", {
		call: async (callProxy) => {
			const call = callProxy.toJs({ dict_converter: Object.fromEntries });
			return { id: call.id, ok: true, value: call.args.s.length };
		},
	});
	instance.runPython(GUEST);
	const toolCall = await measureToolCalls((code) => instance.runPythonAsync(code));

	return {
		version: instance.version,
		startMs: round(median(startSamples.slice(1))),
		snapshotStartMs: round(median(snapshotSamples.slice(1))),
		memoryBytesPerInstance: Math.round((after - before) / kept.length),
		toolCall,
	};
}

async function measureMicroPython() {
	const firstResponse = async () => {
		const startedAt = process.hrtime.bigint();
		const instance = await loadMicroPython({ stdout: () => {} });
		instance.runPython("first_response = 1 + 1");
		const answer = instance.globals.get("first_response");
		const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
		if (answer !== 2) throw new Error(`micropython answered ${answer}`);
		return { instance, elapsedMs };
	};

	console.error("phase: micropython start");
	const startSamples = [];
	for (let run = 0; run < 22; run++) startSamples.push((await firstResponse()).elapsedMs);

	console.error("phase: micropython memory");
	const before = await settledRss();
	const kept = [];
	for (let index = 0; index < 20; index++) kept.push((await firstResponse()).instance);
	const after = await settledRss();

	// MicroPython's JS bridge keeps per-realm state, so only the newest instance can make host calls.
	const instance = kept[kept.length - 1];
	instance.registerJsModule("host", {
		call: async (callProxy) => {
			const call = typeof callProxy.toJs === "function" ? callProxy.toJs() : callProxy;
			const id = call instanceof Map ? call.get("id") : call.id;
			const args = call instanceof Map ? call.get("args") : call.args;
			const text = args instanceof Map ? args.get("s") : args.s;
			return { id, ok: true, value: text.length };
		},
	});
	console.error("phase: micropython tool calls");
	instance.runPython(GUEST);
	const toolCall = await measureToolCalls((code) => instance.runPythonAsync(code));

	return {
		startMs: round(median(startSamples.slice(2))),
		memoryBytesPerInstance: Math.round((after - before) / kept.length),
		toolCall,
	};
}

const results = {
	measuredAt: new Date().toISOString(),
	loadAverage: os.loadavg(),
	node: process.version,
	micropython: await measureMicroPython(),
	pyodide: await measurePyodide(),
};
console.log(JSON.stringify(results, null, 2));
