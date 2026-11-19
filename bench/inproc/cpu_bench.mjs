// Measures wall time and CPU per tool call for each boundary, with a tool that answers at once.
//
// Run with: node cpu_bench.mjs <dir containing echo.mjs and http_server.mjs>
// Each call sends { id, tool, args } and gets { id, ok, value } back, one call at a time.
// CPU counts every process involved: the host, plus the child for pipes and HTTP.
// Wall time is the median over batches of 100 calls; CPU is total CPU divided by calls.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC } from "quickjs-emscripten";

const require = createRequire(import.meta.url);
const ivm = require("isolated-vm");
const here = path.dirname(fileURLToPath(import.meta.url));
const childScripts = process.argv[2];

const WARMUP_CALLS = 2_000;
const MEASURED_CALLS = 20_000;
const BATCH = 100;

const GUEST_LOOP = `
	for (let id = firstId; id < firstId + count; id++) {
		const reply = CALL_HOST({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
		if (reply.id !== id) throw new Error("reply mismatch");
	}
`;

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

function cpuMicros(usage) {
	return usage.user + usage.system;
}

function answer(call) {
	return { id: call.id, ok: true, value: call.args.s.length };
}

/**
 * Runs warm-up and measured batches through `runBatch`.
 * `readOtherCpu` returns the CPU microseconds of any other process that serves the calls.
 */
async function measure(runBatch, readOtherCpu = async () => 0) {
	await runBatch(WARMUP_CALLS, 0);

	const otherStart = await readOtherCpu();
	const hostStart = process.cpuUsage();
	const batchMeans = [];
	for (let index = 0; index < MEASURED_CALLS / BATCH; index++) {
		const startedAt = process.hrtime.bigint();
		await runBatch(BATCH, WARMUP_CALLS + index * BATCH);
		batchMeans.push(Number(process.hrtime.bigint() - startedAt) / 1e3 / BATCH);
	}
	const hostCpu = cpuMicros(process.cpuUsage(hostStart));
	const otherCpu = (await readOtherCpu()) - otherStart;

	return {
		wallUs: Number(median(batchMeans).toFixed(2)),
		cpuUs: Number(((hostCpu + otherCpu) / MEASURED_CALLS).toFixed(2)),
		hostCpuUs: Number((hostCpu / MEASURED_CALLS).toFixed(2)),
		otherCpuUs: Number((otherCpu / MEASURED_CALLS).toFixed(2)),
	};
}

async function v8IsolateAsync() {
	const isolate = new ivm.Isolate({ memoryLimit: 128 });
	const context = await isolate.createContext();
	await context.global.set("hostRef", new ivm.Reference(answer));
	const loop = GUEST_LOOP.replace(
		"CALL_HOST(",
		"await hostRef.apply(undefined, [",
	).replace("});\n", "}], { arguments: { copy: true }, result: { promise: true, copy: true } });\n");
	await context.eval(`globalThis.batch = async (count, firstId) => { ${loop} };`);
	const batch = await context.global.get("batch", { reference: true });
	const result = await measure((count, firstId) => batch.apply(undefined, [count, firstId], { result: { promise: true } }));
	isolate.dispose();
	return result;
}

async function v8IsolateSync() {
	const isolate = new ivm.Isolate({ memoryLimit: 128 });
	const context = isolate.createContextSync();
	context.global.setSync("hostRef", new ivm.Reference(answer));
	const loop = GUEST_LOOP.replace("CALL_HOST(", "hostRef.applySync(undefined, [").replace(
		"});\n",
		"}], { arguments: { copy: true }, result: { copy: true } });\n",
	);
	context.evalSync(`globalThis.batch = (count, firstId) => { ${loop} };`);
	const batch = context.global.getSync("batch", { reference: true });
	const result = await measure(async (count, firstId) => batch.applySync(undefined, [count, firstId]));
	isolate.dispose();
	return result;
}

async function quickjsOwnModuleAsync() {
	const wasmPath = path.join(here, "node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm");
	const wasmModule = await WebAssembly.compile(fs.readFileSync(wasmPath));
	const module = await newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmModule }));
	const runtime = module.newRuntime();
	const context = runtime.newContext();

	// The host answers at once: it resolves the promise before returning it.
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

	const loop = GUEST_LOOP.replace("CALL_HOST(", "await host(");
	context.unwrapResult(context.evalCode(`globalThis.batch = async (count, firstId) => { ${loop} };`)).dispose();
	const batch = context.getProp(context.global, "batch");

	const runBatch = async (count, firstId) => {
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

	const result = await measure(runBatch);
	batch.dispose();
	context.dispose();
	runtime.dispose();
	return result;
}

/** Talks JSON lines over stdio pipes to a child runtime running echo.mjs. */
async function pipeChild(command, args) {
	const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
	child.stdout.setEncoding("utf8");
	let buffered = "";
	let deliver = null;
	child.stdout.on("data", (chunk) => {
		buffered += chunk;
		let newline = buffered.indexOf("\n");
		while (newline >= 0) {
			const line = buffered.slice(0, newline);
			buffered = buffered.slice(newline + 1);
			deliver(JSON.parse(line));
			newline = buffered.indexOf("\n");
		}
	});
	const send = (message) =>
		new Promise((resolve) => {
			deliver = resolve;
			child.stdin.write(JSON.stringify(message) + "\n");
		});

	const runBatch = async (count, firstId) => {
		for (let id = firstId; id < firstId + count; id++) {
			const reply = await send({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
			if (reply.id !== id) throw new Error("reply mismatch");
		}
	};
	const childCpu = async () => cpuMicros((await send({ cmd: "cpu" })).cpu);

	const result = await measure(runBatch, childCpu);
	child.stdin.end();
	await once(child, "exit");
	return result;
}

/** Sends JSON over one keep-alive loopback HTTP connection to http_server.mjs. */
async function loopbackHttp() {
	const server = spawn(process.execPath, [path.join(childScripts, "http_server.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
	server.stdout.setEncoding("utf8");
	const [portLine] = await once(server.stdout, "data");
	const port = Number(portLine.trim());
	const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

	const request = (method, urlPath, body) =>
		new Promise((resolve, reject) => {
			const headers = body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {};
			const outgoing = http.request({ host: "127.0.0.1", port, method, path: urlPath, agent, headers }, (response) => {
				let text = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					text += chunk;
				});
				response.on("end", () => resolve(JSON.parse(text)));
			});
			outgoing.on("error", reject);
			outgoing.end(body);
		});

	const runBatch = async (count, firstId) => {
		for (let id = firstId; id < firstId + count; id++) {
			const body = JSON.stringify({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
			const reply = await request("POST", "/call", body);
			if (reply.id !== id) throw new Error("reply mismatch");
		}
	};
	const serverCpu = async () => cpuMicros((await request("GET", "/cpu")).cpu);

	const result = await measure(runBatch, serverCpu);
	agent.destroy();
	server.kill();
	return result;
}

const echo = path.join(childScripts, "echo.mjs");
const results = {
	measuredAt: new Date().toISOString(),
	loadAverage: os.loadavg(),
	node: process.version,
	v8IsolateSync: await v8IsolateSync(),
	v8IsolateAsync: await v8IsolateAsync(),
	quickjsOwnModuleAsync: await quickjsOwnModuleAsync(),
	nodePipe: await pipeChild("node", [echo]),
	denoPipe: await pipeChild("deno", ["run", "--quiet", echo]),
	bunPipe: await pipeChild("bun", [echo]),
	loopbackHttp: await loopbackHttp(),
};

console.log(JSON.stringify(results, null, 2));
