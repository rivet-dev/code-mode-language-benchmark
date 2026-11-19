// Measures each scripting runtime run as a separate process, with the shared definitions:
//   start: spawn until the host reads the sandbox's first response, the result of 1 + 1;
//   memory: private memory (USS) of an idle sandbox after its first response;
//   tool call: an already-running sandbox calls the host over stdio and the host answers at once,
//              with wall time per call and CPU summed over the host and the sandbox.
// When bash is selected, also measures bash calling a tool by running one external command per call.
//
// Usage: node suite.mjs <process runtimes module> [runtime key ...]
// The module, one per language folder, exports PROCESS_RUNTIMES: [{ key, idle, guest }], where
// idle and guest are [command, args]. Results go to stdout as JSON; progress goes to stderr.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const START_RUNS = 40;
const MEMORY_SANDBOXES = 20;
const CALLS = 50_000;
const WARMUP = 5_000;
const BATCH = 500;
const COMMAND_CALLS = 2_000;
const CLOCK_TICKS = Number(execFileSync("getconf", ["CLK_TCK"]).toString().trim());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const cpuMicros = (usage) => usage.user + usage.system;

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

/** Returns user plus system CPU microseconds for a live process, read from /proc. */
function processCpuMicros(pid) {
	const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	return ((Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS) * 1e6;
}

/** Returns private (USS) and proportional (PSS) memory in bytes for a live process. */
function processMemory(pid) {
	const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
	const field = (name) => Number(rollup.match(new RegExp(`^${name}:\\s+(\\d+) kB`, "m"))[1]) * 1024;
	return { uss: field("Private_Clean") + field("Private_Dirty"), pss: field("Pss") };
}

/** Spawns an idle sandbox and resolves once its first line of output reaches the host. */
async function spawnUntilFirstResponse(command, args) {
	const startedAt = process.hrtime.bigint();
	const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
	child.stdout.setEncoding("utf8");
	let text = "";
	await new Promise((resolve, reject) => {
		const onData = (chunk) => {
			text += chunk;
			if (text.includes("\n")) {
				child.stdout.off("data", onData);
				resolve();
			}
		};
		child.stdout.on("data", onData);
		child.once("error", reject);
		child.once("exit", (code) => reject(new Error(`${command} exited with ${code} before responding`)));
	});
	const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
	if (text.trim() !== "2") throw new Error(`${command} answered ${JSON.stringify(text)}`);
	return { child, elapsedMs };
}

async function stopSandbox(child) {
	child.stdin.end();
	if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
}

async function measureStart(command, args) {
	const samples = [];
	for (let run = 0; run < START_RUNS + 2; run++) {
		const { child, elapsedMs } = await spawnUntilFirstResponse(command, args);
		await stopSandbox(child);
		if (run >= 2) samples.push(elapsedMs);
	}
	return round(median(samples));
}

async function measureMemory(command, args) {
	const sandboxes = [];
	for (let index = 0; index < MEMORY_SANDBOXES; index++) {
		sandboxes.push((await spawnUntilFirstResponse(command, args)).child);
	}
	await sleep(500);
	const readings = sandboxes.map((child) => processMemory(child.pid));
	await Promise.all(sandboxes.map(stopSandbox));
	return { ussBytes: median(readings.map((reading) => reading.uss)), pssBytes: median(readings.map((reading) => reading.pss)) };
}

/** Runs a guest that calls the host CALLS times; the host answers each call at once. */
async function measureToolCalls(command, args) {
	const child = spawn(command, [...args, String(CALLS), String(WARMUP), String(BATCH)], { stdio: ["pipe", "pipe", "inherit"] });
	child.stdout.setEncoding("utf8");
	const marks = [];
	const callTimes = [];
	let buffered = "";

	await new Promise((resolve, reject) => {
		child.once("exit", (code) => reject(new Error(`${command} exited with ${code} mid-run`)));
		child.stdout.on("data", (chunk) => {
			buffered += chunk;
			let newline = buffered.indexOf("\n");
			while (newline >= 0) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				newline = buffered.indexOf("\n");
				if (line === "mark") {
					marks.push({ at: process.hrtime.bigint(), hostCpu: cpuMicros(process.cpuUsage()), sandboxCpu: processCpuMicros(child.pid) });
				} else if (line === "done") {
					resolve();
				} else {
					// Time every call in the measured window for a true per-call median.
					if (marks.length > 0) callTimes.push(process.hrtime.bigint());
					const call = JSON.parse(line);
					child.stdin.write(JSON.stringify({ id: call.id, ok: true, value: call.args.s.length }) + "\n");
				}
			}
		});
	});
	await stopSandbox(child);

	const batchMeansUs = [];
	for (let index = 1; index < marks.length; index++) {
		batchMeansUs.push(Number(marks[index].at - marks[index - 1].at) / 1e3 / BATCH);
	}
	const first = marks[0];
	const last = marks[marks.length - 1];
	const hostCpuUs = (last.hostCpu - first.hostCpu) / CALLS;
	const sandboxCpuUs = (last.sandboxCpu - first.sandboxCpu) / CALLS;
	const perCallUs = [];
	for (let index = 1; index < callTimes.length; index++) perCallUs.push(Number(callTimes[index] - callTimes[index - 1]) / 1e3);
	return { wallUs: round(median(perCallUs)), batchWallUs: round(median(batchMeansUs)), cpuUs: round(hostCpuUs + sandboxCpuUs), hostCpuUs: round(hostCpuUs), sandboxCpuUs: round(sandboxCpuUs) };
}

/** Parses one line of bash's `times` output ("0m0.012s 0m0.034s") into microseconds. */
function parseTimesLine(line) {
	return line
		.trim()
		.split(/\s+/)
		.map((part) => {
			const [, minutes, seconds] = part.match(/(\d+)m([\d.]+)s/);
			return (Number(minutes) * 60 + Number(seconds)) * 1e6;
		})
		.reduce((sum, value) => sum + value, 0);
}

/** bash calls a tool by running an external command; reports wall and CPU per command. */
function measureBashCommands(toolCommand) {
	const script = `for ((i = 0; i < ${COMMAND_CALLS}; i++)); do ${toolCommand} >/dev/null; done; times`;
	const startedAt = process.hrtime.bigint();
	const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
	const elapsedUs = Number(process.hrtime.bigint() - startedAt) / 1e3;
	if (result.status !== 0) throw new Error(`bash command loop failed: ${result.stderr}`);
	const [shellCpu, childrenCpu] = result.stdout.trim().split("\n").map(parseTimesLine);
	return { wallUs: round(elapsedUs / COMMAND_CALLS), cpuUs: round((shellCpu + childrenCpu) / COMMAND_CALLS) };
}

const [runtimesModule, ...selectedKeys] = process.argv.slice(2);
const { PROCESS_RUNTIMES } = await import(pathToFileURL(path.resolve(runtimesModule)).href);
const RUNTIMES = PROCESS_RUNTIMES.filter((runtime) => selectedKeys.length === 0 || selectedKeys.includes(runtime.key));
for (const key of selectedKeys) {
	if (!RUNTIMES.some((runtime) => runtime.key === key)) throw new Error(`${runtimesModule} has no runtime ${key}`);
}

const results = {
	measuredAt: new Date().toISOString(),
	loadAverageBefore: os.loadavg(),
	runtimes: {},
};
for (const runtime of RUNTIMES) {
	const [idleCommand, idleArgs] = runtime.idle;
	const [guestCommand, guestArgs] = runtime.guest;
	const entry = {
		startMs: await measureStart(idleCommand, idleArgs),
		memory: await measureMemory(idleCommand, idleArgs),
		toolCall: await measureToolCalls(guestCommand, guestArgs),
	};
	results.runtimes[runtime.key] = entry;
	console.error(`${runtime.key}: ${JSON.stringify(entry)}`);
}
if (RUNTIMES.some((runtime) => runtime.key === "bash")) {
	results.bashCommandPerCall = { trueBinary: measureBashCommands("/bin/true") };
}
results.loadAverageAfter = os.loadavg();

console.log(JSON.stringify(results, null, 2));
