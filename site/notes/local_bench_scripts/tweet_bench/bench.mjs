// Measures process start time and one tool-call round trip across a process boundary.
//
// Usage: node bench.mjs <dir containing echo.mjs and http_server.mjs>
// Start time is spawn to exit for an empty program. A tool call is one JSON request and
// its reply, sent sequentially, over stdio pipes to a child runtime or over keep-alive
// HTTP on loopback. Loopback is a lower bound for a container or microVM, whose traffic
// crosses a virtual network device instead.
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import path from "node:path";

const scriptDir = process.argv[2];
const START_RUNS = 40;
const WARMUP_CALLS = 2_000;
const MEASURED_CALLS = 20_000;

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, fraction) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function summarize(samples) {
	return {
		median: Number(median(samples).toFixed(2)),
		p90: Number(percentile(samples, 0.9).toFixed(2)),
		mean: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(2)),
		runs: samples.length,
	};
}

/** Times spawn-to-exit for an empty program, after two untimed warm runs. */
function measureStart(command, args) {
	const samples = [];
	for (let run = 0; run < START_RUNS + 2; run++) {
		const startedAt = process.hrtime.bigint();
		const result = spawnSync(command, args, { stdio: "ignore" });
		const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
		if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
		if (run >= 2) samples.push(elapsedMs);
	}
	return summarize(samples);
}

function toolCall(id) {
	return JSON.stringify({ id, tool: "lookup", args: { s: "hello from the sandbox" } });
}

/** Sends sequential JSON calls to a child over stdio pipes and times each reply in microseconds. */
async function measurePipe(command, args) {
	const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
	child.stdout.setEncoding("utf8");

	let buffered = "";
	let deliverReply = null;
	child.stdout.on("data", (chunk) => {
		buffered += chunk;
		let newline = buffered.indexOf("\n");
		while (newline >= 0) {
			const line = buffered.slice(0, newline);
			buffered = buffered.slice(newline + 1);
			deliverReply(line);
			newline = buffered.indexOf("\n");
		}
	});

	const call = (id) =>
		new Promise((resolve) => {
			deliverReply = resolve;
			child.stdin.write(toolCall(id) + "\n");
		});

	const samples = [];
	for (let id = 0; id < WARMUP_CALLS + MEASURED_CALLS; id++) {
		const startedAt = process.hrtime.bigint();
		const reply = JSON.parse(await call(id));
		const elapsedUs = Number(process.hrtime.bigint() - startedAt) / 1e3;
		if (reply.id !== id) throw new Error(`reply ${reply.id} answered call ${id}`);
		if (id >= WARMUP_CALLS) samples.push(elapsedUs);
	}

	child.stdin.end();
	await once(child, "exit");
	return summarize(samples);
}

/** Sends sequential JSON calls over one keep-alive loopback connection and times each reply. */
async function measureHttp() {
	const server = spawn(process.execPath, [path.join(scriptDir, "http_server.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
	server.stdout.setEncoding("utf8");
	const [portLine] = await once(server.stdout, "data");
	const port = Number(portLine.trim());
	const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

	const call = (id) =>
		new Promise((resolve, reject) => {
			const body = toolCall(id);
			const request = http.request(
				{ host: "127.0.0.1", port, method: "POST", path: "/call", agent, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
				(response) => {
					let text = "";
					response.setEncoding("utf8");
					response.on("data", (chunk) => {
						text += chunk;
					});
					response.on("end", () => resolve(text));
				},
			);
			request.on("error", reject);
			request.end(body);
		});

	const samples = [];
	for (let id = 0; id < WARMUP_CALLS + MEASURED_CALLS; id++) {
		const startedAt = process.hrtime.bigint();
		const reply = JSON.parse(await call(id));
		const elapsedUs = Number(process.hrtime.bigint() - startedAt) / 1e3;
		if (reply.id !== id) throw new Error(`reply ${reply.id} answered call ${id}`);
		if (id >= WARMUP_CALLS) samples.push(elapsedUs);
	}

	agent.destroy();
	server.kill();
	return summarize(samples);
}

const echo = path.join(scriptDir, "echo.mjs");
const results = {
	measuredAt: new Date().toISOString(),
	loadAverage: (await import("node:os")).loadavg(),
	versions: {
		node: process.version,
		deno: spawnSync("deno", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0],
		bun: spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout.trim(),
	},
	startMs: {
		node: measureStart("node", ["-e", "0"]),
		deno: measureStart("deno", ["eval", "0"]),
		bun: measureStart("bun", ["-e", "0"]),
	},
	toolCallUs: {
		nodePipe: await measurePipe("node", [echo]),
		denoPipe: await measurePipe("deno", ["run", "--quiet", echo]),
		bunPipe: await measurePipe("bun", [echo]),
		loopbackHttp: await measureHttp(),
	},
};

console.log(JSON.stringify(results, null, 2));
