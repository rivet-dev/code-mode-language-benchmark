// Memory each separate-process sandbox adds above baseline, as charged to this cgroup.
//
// Run inside its own scope: systemd-run --user --scope -p MemoryAccounting=yes node memory_cgroup.mjs
// For each runtime: warm it once, read memory.current, start SANDBOXES idle sandboxes that have
// each answered 1 + 1, read memory.current again, and divide the increase by SANDBOXES. Unlike
// USS, the cgroup charge includes the kernel's per-process memory (page tables, kernel stacks).
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SANDBOXES = 20;
const ROUNDS = 3;
const STAT_FIELDS = ["anon", "file", "kernel", "kernel_stack", "pagetables", "slab", "sock"];

const cgroupDir = `/sys/fs/cgroup${fs.readFileSync("/proc/self/cgroup", "utf8").trim().split(":").pop()}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

function chargedBytes() {
	return Number(fs.readFileSync(path.join(cgroupDir, "memory.current"), "utf8"));
}

function statBytes() {
	const stat = {};
	for (const line of fs.readFileSync(path.join(cgroupDir, "memory.stat"), "utf8").split("\n")) {
		const [name, value] = line.split(" ");
		if (STAT_FIELDS.includes(name)) stat[name] = Number(value);
	}
	return stat;
}

/** Starts an idle sandbox and resolves once its first line of output, "2", arrives. */
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
	const perSandbox = [];
	let composition = null;
	for (let round = 0; round < ROUNDS; round++) {
		await sleep(300);
		const before = chargedBytes();
		const statBefore = statBytes();
		const sandboxes = [];
		for (let index = 0; index < SANDBOXES; index++) sandboxes.push(await startSandbox(command, args));
		await sleep(500);
		const after = chargedBytes();
		const statAfter = statBytes();
		await Promise.all(sandboxes.map(stopSandbox));
		perSandbox.push((after - before) / SANDBOXES);
		composition = Object.fromEntries(STAT_FIELDS.map((name) => [name, Math.round((statAfter[name] - statBefore[name]) / SANDBOXES)]));
	}
	return { bytesPerSandbox: Math.round(median(perSandbox)), rounds: perSandbox.map(Math.round), lastRoundComposition: composition };
}

const idleScript = path.join(here, "idle.mjs");
const RUNTIMES = {
	node: ["node", [idleScript]],
	deno: ["deno", ["run", "--quiet", idleScript]],
	bun: ["bun", [idleScript]],
	python: ["python3", ["-c", "print(1 + 1, flush=True); import sys; sys.stdin.read()"]],
	lua: ["lua", ["-e", "io.write(1 + 1, '\\n') io.stdout:flush() io.read('*a')"]],
	luajit: ["luajit", ["-e", "io.write(1 + 1, '\\n') io.stdout:flush() io.read('*a')"]],
	bash: ["bash", ["-c", "echo $((1 + 1)); read -r _"]],
	dash: ["dash", ["-c", "echo $((1 + 1)); read _"]],
};

const results = { measuredAt: new Date().toISOString(), cgroup: cgroupDir, sandboxes: SANDBOXES, rounds: ROUNDS, runtimes: {} };
for (const [key, [command, args]] of Object.entries(RUNTIMES)) {
	results.runtimes[key] = await measure(command, args);
	console.error(`${key}: ${JSON.stringify(results.runtimes[key])}`);
}
console.log(JSON.stringify(results, null, 2));
