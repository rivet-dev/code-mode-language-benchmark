// Re-measures memory per separate-process sandbox the way memory_cgroup.mjs does (memory.current
// delta over K idle sandboxes), and adds two cross-checks:
//   - memory.stat composition read again after 2.5 s, past the kernel's periodic stats flush;
//   - memory.current re-read at the same time, to see whether per-CPU charge caches drained.
//
// Run inside its own scope: systemd-run --user --scope -p MemoryAccounting=yes [taskset -c N] node memory_cgroup2.mjs <suite dir>
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const suiteDir = process.argv[2];
const SANDBOXES = Number(process.env.SANDBOXES ?? 20);
const ROUNDS = 3;
const STAT_FIELDS = ["anon", "file", "kernel", "kernel_stack", "pagetables", "slab", "percpu", "sock"];

const cgroupDir = `/sys/fs/cgroup${fs.readFileSync("/proc/self/cgroup", "utf8").trim().split(":").pop()}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

const chargedBytes = () => Number(fs.readFileSync(path.join(cgroupDir, "memory.current"), "utf8"));

function statBytes() {
	const stat = {};
	for (const line of fs.readFileSync(path.join(cgroupDir, "memory.stat"), "utf8").split("\n")) {
		const [name, value] = line.split(" ");
		if (STAT_FIELDS.includes(name)) stat[name] = Number(value);
	}
	return stat;
}

function processUss(pid) {
	const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
	const field = (name) => Number(rollup.match(new RegExp(`^${name}:\\s+(\\d+) kB`, "m"))[1]) * 1024;
	return field("Private_Clean") + field("Private_Dirty");
}

async function startSandbox(command, args) {
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
		child.once("exit", (code) => reject(new Error(`${command} exited with ${code} before responding`)));
	});
	if (text.trim() !== "2") throw new Error(`${command} answered ${JSON.stringify(text)}`);
	return child;
}

async function stopSandbox(child) {
	child.stdin.end();
	if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
}

async function measure(command, args) {
	await stopSandbox(await startSandbox(command, args));
	const rounds = [];
	for (let round = 0; round < ROUNDS; round++) {
		await sleep(3000);
		const before = chargedBytes();
		const statBefore = statBytes();
		const sandboxes = [];
		for (let index = 0; index < SANDBOXES; index++) sandboxes.push(await startSandbox(command, args));
		await sleep(500);
		const after = chargedBytes();
		await sleep(2500);
		const afterSettled = chargedBytes();
		const statAfter = statBytes();
		const ussMedian = median(sandboxes.map((child) => processUss(child.pid)));
		await Promise.all(sandboxes.map(stopSandbox));
		const perSandbox = (value) => Math.round(value / SANDBOXES);
		const composition = Object.fromEntries(STAT_FIELDS.map((name) => [name, perSandbox(statAfter[name] - statBefore[name])]));
		rounds.push({
			currentAt500ms: perSandbox(after - before),
			currentAt3s: perSandbox(afterSettled - before),
			statAnonPlusFilePlusKernel: composition.anon + composition.file + composition.kernel,
			ussMedian,
			composition,
		});
	}
	return {
		bytesPerSandbox: median(rounds.map((round) => round.currentAt500ms)),
		bytesPerSandboxAt3s: median(rounds.map((round) => round.currentAt3s)),
		statSumPerSandbox: median(rounds.map((round) => round.statAnonPlusFilePlusKernel)),
		ussMedian: median(rounds.map((round) => round.ussMedian)),
		rounds,
	};
}

const idleScript = path.join(suiteDir, "idle.mjs");
const RUNTIMES = {
	dash: ["dash", ["-c", "echo $((1 + 1)); read _"]],
	lua: ["lua", ["-e", "io.write(1 + 1, '\\n') io.stdout:flush() io.read('*a')"]],
	luajit: ["luajit", ["-e", "io.write(1 + 1, '\\n') io.stdout:flush() io.read('*a')"]],
	bash: ["bash", ["-c", "echo $((1 + 1)); read -r _"]],
	python: ["python3", ["-c", "print(1 + 1, flush=True); import sys; sys.stdin.read()"]],
	node: ["node", [idleScript]],
	bun: ["bun", [idleScript]],
	deno: ["deno", ["run", "--quiet", idleScript]],
};
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);

const results = {
	measuredAt: new Date().toISOString(),
	cgroup: cgroupDir,
	cpusAllowed: fs.readFileSync("/proc/self/status", "utf8").match(/^Cpus_allowed_list:\s+(.*)$/m)[1],
	sandboxes: SANDBOXES,
	rounds: ROUNDS,
	loadBefore: os.loadavg(),
	runtimes: {},
};
for (const [key, [command, args]] of Object.entries(RUNTIMES)) {
	if (only.length > 0 && !only.includes(key)) continue;
	const loadBefore = os.loadavg()[0];
	results.runtimes[key] = { loadBefore, ...(await measure(command, args)) };
	const { rounds, ...summary } = results.runtimes[key];
	console.error(`${key}: ${JSON.stringify(summary)}`);
}
results.loadAfter = os.loadavg();
console.log(JSON.stringify(results, null, 2));
