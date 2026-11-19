// Memory each separate-process sandbox adds above baseline, as charged to this cgroup.
//
// Run inside its own scope:
//   systemd-run --user --scope -p MemoryAccounting=yes node memory_cgroup.mjs <process runtimes module> [runtime key ...]
// The module is the same one suite.mjs reads; only each runtime's idle command is used here.
// For each runtime: warm it once, read memory.current, start SANDBOXES idle sandboxes that have
// each answered 1 + 1, read memory.current again, and divide the increase by SANDBOXES. Unlike
// USS, the cgroup charge includes the kernel's per-process memory (page tables, kernel stacks).
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

const [runtimesModule, ...selectedKeys] = process.argv.slice(2);
const { PROCESS_RUNTIMES } = await import(pathToFileURL(path.resolve(runtimesModule)).href);
const RUNTIMES = Object.fromEntries(
	PROCESS_RUNTIMES.filter((runtime) => selectedKeys.length === 0 || selectedKeys.includes(runtime.key)).map((runtime) => [runtime.key, runtime.idle]),
);
for (const key of selectedKeys) {
	if (!(key in RUNTIMES)) throw new Error(`${runtimesModule} has no runtime ${key}`);
}

const results = { measuredAt: new Date().toISOString(), cgroup: cgroupDir, sandboxes: SANDBOXES, rounds: ROUNDS, runtimes: {} };
for (const [key, [command, args]] of Object.entries(RUNTIMES)) {
	results.runtimes[key] = await measure(command, args);
	console.error(`${key}: ${JSON.stringify(results.runtimes[key])}`);
}
console.log(JSON.stringify(results, null, 2));
