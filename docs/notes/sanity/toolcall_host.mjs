// Re-measures a process tool call exactly as suite.mjs does (median of 500-call batch means,
// CPU summed over host and sandbox), and also records every call's own round trip so the
// per-call median and mean can be compared with the batch-mean figure the chart reports.
//
// Usage: node toolcall_host.mjs <label> <calls> <warmup> <batch> <command> [args...]
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";

const [label, callsText, warmupText, batchText, command, ...args] = process.argv.slice(2);
const CALLS = Number(callsText);
const WARMUP = Number(warmupText);
const BATCH = Number(batchText);
const CLOCK_TICKS = Number(execFileSync("getconf", ["CLK_TCK"]).toString().trim());

const round = (value, digits = 2) => Number(value.toFixed(digits));
const cpuMicros = (usage) => usage.user + usage.system;

function quantile(values, fraction) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function processCpuMicros(pid) {
	const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	return ((Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS) * 1e6;
}

const loadBefore = os.loadavg()[0];
const child = spawn(command, [...args, String(CALLS), String(WARMUP), String(BATCH)], { stdio: ["pipe", "pipe", "inherit"] });
child.stdout.setEncoding("utf8");
const marks = [];
const callArrivals = [];
let measuring = false;
let buffered = "";

await new Promise((resolve, reject) => {
	child.once("exit", (code) => reject(new Error(`${command} exited with ${code} mid-run`)));
	child.stdout.on("data", (chunk) => {
		const arrivedAt = process.hrtime.bigint();
		buffered += chunk;
		let newline = buffered.indexOf("\n");
		while (newline >= 0) {
			const line = buffered.slice(0, newline);
			buffered = buffered.slice(newline + 1);
			newline = buffered.indexOf("\n");
			if (line === "mark") {
				measuring = true;
				marks.push({ at: process.hrtime.bigint(), hostCpu: cpuMicros(process.cpuUsage()), sandboxCpu: processCpuMicros(child.pid) });
			} else if (line === "done") {
				resolve();
			} else {
				const call = JSON.parse(line);
				if (measuring) callArrivals.push(arrivedAt);
				child.stdin.write(JSON.stringify({ id: call.id, ok: true, value: call.args.s.length }) + "\n");
			}
		}
	});
});
child.stdin.end();
if (child.exitCode === null && child.signalCode === null) await once(child, "exit");

const batchMeansUs = [];
for (let index = 1; index < marks.length; index++) {
	batchMeansUs.push(Number(marks[index].at - marks[index - 1].at) / 1e3 / BATCH);
}
const perCallUs = [];
for (let index = 1; index < callArrivals.length; index++) {
	perCallUs.push(Number(callArrivals[index] - callArrivals[index - 1]) / 1e3);
}
const first = marks[0];
const last = marks[marks.length - 1];
const hostCpuUs = (last.hostCpu - first.hostCpu) / CALLS;
const sandboxCpuUs = (last.sandboxCpu - first.sandboxCpu) / CALLS;

console.log(JSON.stringify({
	label,
	measuredAt: new Date().toISOString(),
	loadBefore: round(loadBefore),
	loadAfter: round(os.loadavg()[0]),
	calls: CALLS,
	batchMeanMedianUs: round(quantile(batchMeansUs, 0.5)),
	perCallMedianUs: round(quantile(perCallUs, 0.5)),
	perCallMeanUs: round(perCallUs.reduce((sum, value) => sum + value, 0) / perCallUs.length),
	perCallP90Us: round(quantile(perCallUs, 0.9)),
	perCallP99Us: round(quantile(perCallUs, 0.99)),
	cpuUs: round(hostCpuUs + sandboxCpuUs),
	hostCpuUs: round(hostCpuUs),
	sandboxCpuUs: round(sandboxCpuUs),
}));
