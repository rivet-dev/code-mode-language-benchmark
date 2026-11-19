// Usage: node --expose-gc monty_bench.mjs <dir containing node_modules/@pydantic/monty> <native|wasm>
// Measures Monty pool creation, per-worker memory, feed latency, speed, and host-call overhead.
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";

const dir = process.argv[2];
const mode = process.argv[3];
const base = `${dir}/node_modules/@pydantic/monty/dist`;
const { Monty } = await import(pathToFileURL(mode === "native" ? `${base}/node.js` : `${base}/worker/index.node.js`).href);

const mb = () => process.memoryUsage().rss / 1048576;
const now = () => performance.now();
const settle = async () => {
	for (let i = 0; i < 3; i++) {
		if (global.gc) global.gc();
		await new Promise((r) => setTimeout(r, 50));
	}
};
function childRssMB() {
	// Sum RSS of direct child processes of this Node process.
	let total = 0;
	let count = 0;
	for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
		try {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
			if (ppid !== process.pid) continue;
			const status = readFileSync(`/proc/${pid}/status`, "utf8");
			const m = status.match(/VmRSS:\s+(\d+)/);
			if (m) {
				total += Number(m[1]) / 1024;
				count++;
			}
		} catch {}
	}
	return { total, count };
}
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

const out = { mode, node: process.version };
await settle();
out.baselineRssMB = mb();

let t = now();
const pool = await Monty.create({ minProcesses: 1, maxProcesses: 16 });
out.poolCreateMs = now() - t;
t = now();
const s = await pool.checkout({ limits: { maxSuspensions: 2000000 } });
out.firstCheckoutMs = now() - t;
t = now();
await s.feedRun("1 + 1");
out.firstFeedMs = now() - t;
const lat = [];
for (let i = 0; i < 200; i++) {
	t = now();
	await s.feedRun("x = 1 + 1\nx");
	lat.push(now() - t);
}
out.feedRunMedianMs = median(lat);

t = now();
await s.feedRun("def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\nfib(25)");
out.fib25Ms = now() - t;
t = now();
await s.feedRun("s = 0\nfor i in range(1000000):\n    s += i * i\ns");
out.loop1e6Ms = now() - t;

// Sync host function round trips.
t = now();
await s.feedRun("for i in range(10000):\n    hostf(i)", { externalLookup: { hostf: (x) => x + 1 } });
out.syncHostCallUs = ((now() - t) * 1000) / 10000;

// Async host function, serial awaits.
try {
	t = now();
	await s.feedRun("for i in range(2000):\n    await ahost(i)", { externalLookup: { ahost: async (x) => x + 1 } });
	out.asyncHostCallUs = ((now() - t) * 1000) / 2000;
} catch (e) {
	out.asyncHostError = String(e).slice(0, 200);
}
// 1000 concurrent slow host calls (100 ms each).
try {
	t = now();
	await s.feedRun("import asyncio\nr = await asyncio.gather(*[aslow(i) for i in range(1000)])\nlen(r)", {
		externalLookup: { aslow: (x) => new Promise((res) => setTimeout(() => res(x), 100)) },
	});
	out.gather1000x100msMs = now() - t;
} catch (e) {
	out.gatherError = String(e).slice(0, 300);
}

// Memory with 10 concurrent checked-out sessions that each ran a little code.
await settle();
const rssBefore = mb();
const kidsBefore = childRssMB();
const sessions = [];
t = now();
for (let i = 0; i < 10; i++) sessions.push(await pool.checkout());
out.avgCheckoutMsNext10 = (now() - t) / 10;
await Promise.all(sessions.map((x) => x.feedRun("d = {'a': [1, 2, 3]}\nimport json\njson.dumps(d)")));
await settle();
const kidsAfter = childRssMB();
out.parentRssDeltaPerSessionMB = (mb() - rssBefore) / 10;
out.childProcesses = kidsAfter.count;
out.childRssTotalMB = kidsAfter.total;
out.childRssPerSessionMB = (kidsAfter.total - kidsBefore.total) / 10;
out.parentRssMB = mb();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
