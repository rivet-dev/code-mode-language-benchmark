// Re-measures process start exactly as suite.mjs does (Node host, spawn until the first line),
// plus Bun variants that isolate what makes `bun idle.mjs` slow, recording load for each runtime.
//
// Usage: node start_node.mjs <suite dir> <sanity dir> [runtime keys...]
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

const [suiteDir, sanityDir, ...only] = process.argv.slice(2);
const START_RUNS = 40;

const round = (value, digits = 2) => Number(value.toFixed(digits));

function quantile(values, fraction) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

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
	if (child.exitCode === null && child.signalCode === null) {
		const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
		await once(child, "exit");
		clearTimeout(timer);
	}
}

async function measureFirstLine(command, args) {
	const samples = [];
	for (let run = 0; run < START_RUNS + 2; run++) {
		const { child, elapsedMs } = await spawnUntilFirstResponse(command, args);
		await stopSandbox(child);
		if (run >= 2) samples.push(elapsedMs);
	}
	return { medianMs: round(quantile(samples, 0.5)), p10Ms: round(quantile(samples, 0.1)), p90Ms: round(quantile(samples, 0.9)) };
}

/** Spawn to exit for an empty program, as the earlier quiet-host bench.mjs measured it. */
function measureSpawnToExit(command, args) {
	const samples = [];
	for (let run = 0; run < START_RUNS + 2; run++) {
		const startedAt = process.hrtime.bigint();
		const result = spawnSync(command, args, { stdio: "ignore" });
		const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
		if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
		if (run >= 2) samples.push(elapsedMs);
	}
	return { medianMs: round(quantile(samples, 0.5)), p10Ms: round(quantile(samples, 0.1)), p90Ms: round(quantile(samples, 0.9)) };
}

const idle = path.join(suiteDir, "idle.mjs");
const bunIdleConsole = path.join(sanityDir, "idle_bun_console.mjs");
const FIRST_LINE = {
	dash: ["dash", ["-c", "echo $((1 + 1)); read _"]],
	bash: ["bash", ["-c", "echo $((1 + 1)); read -r _"]],
	lua: ["lua", ["-e", "io.write(1 + 1, '\\n') io.stdout:flush() io.read('*a')"]],
	luajit: ["luajit", ["-e", "io.write(1 + 1, '\\n') io.stdout:flush() io.read('*a')"]],
	python: ["python3", ["-c", "print(1 + 1, flush=True); import sys; sys.stdin.read()"]],
	node: ["node", [idle]],
	deno: ["deno", ["run", "--quiet", idle]],
	bun: ["bun", [idle]],
	bunConsoleIdle: ["bun", [bunIdleConsole]],
	bunEvalPrint: ["bun", ["-e", "console.log(1 + 1)"]],
	nodeEvalPrint: ["node", ["-e", "console.log(1 + 1)"]],
};
const SPAWN_TO_EXIT = {
	bunEmpty: ["bun", ["-e", "0"]],
	nodeEmpty: ["node", ["-e", "0"]],
	denoEmpty: ["deno", ["eval", "0"]],
};

const results = { measuredAt: new Date().toISOString(), firstLine: {}, spawnToExit: {} };
for (const [key, [command, args]] of Object.entries(FIRST_LINE)) {
	if (only.length > 0 && !only.includes(key)) continue;
	const loadBefore = os.loadavg()[0];
	const measured = await measureFirstLine(command, args);
	results.firstLine[key] = { ...measured, loadBefore: round(loadBefore), loadAfter: round(os.loadavg()[0]) };
	console.error(`${key}: ${JSON.stringify(results.firstLine[key])}`);
}
for (const [key, [command, args]] of Object.entries(SPAWN_TO_EXIT)) {
	if (only.length > 0 && !only.includes(key)) continue;
	const loadBefore = os.loadavg()[0];
	const measured = measureSpawnToExit(command, args);
	results.spawnToExit[key] = { ...measured, loadBefore: round(loadBefore), loadAfter: round(os.loadavg()[0]) };
	console.error(`${key}: ${JSON.stringify(results.spawnToExit[key])}`);
}
console.log(JSON.stringify(results, null, 2));
