// Usage: node --expose-gc micropython_bench.mjs <dir containing node_modules/@micropython/...>
// Measures MicroPython (Emscripten wasm, pyscript variant) load time, marginal RSS per instance,
// pure-Python speed, and sync/async host-call overhead.
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
const mod = await import(
	pathToFileURL(`${dir}/node_modules/@micropython/micropython-webassembly-pyscript/micropython.mjs`).href
);
const { loadMicroPython } = mod;
const mb = () => process.memoryUsage().rss / 1048576;
const settle = async () => {
	for (let i = 0; i < 3; i++) {
		if (global.gc) global.gc();
		await new Promise((r) => setTimeout(r, 50));
	}
};
const now = () => performance.now();
const out = { node: process.version };
let stdout = "";
await settle();
out.baselineRssMB = mb();
let t = now();
const mp = await loadMicroPython({ stdout: (s) => (stdout += s) });
out.firstLoadMs = now() - t;
await settle();
out.rssAfterFirstMB = mb();

const extra = [];
t = now();
for (let i = 0; i < 50; i++) extra.push(await loadMicroPython({ stdout: () => {} }));
out.avgLoadMsNext50 = (now() - t) / 50;
await settle();
out.marginalRssPerInstanceMB = (mb() - out.rssAfterFirstMB) / 50;

// Larger heap variant.
await settle();
let r = mb();
const big = [];
for (let i = 0; i < 10; i++) big.push(await loadMicroPython({ heapsize: 16 * 1024 * 1024, stdout: () => {} }));
await settle();
out.marginalRssPerInstance16MBHeapMB = (mb() - r) / 10;
const mpLast = await loadMicroPython({ stdout: () => {} });

t = now();
mpLast.runPython("def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\n_r = fib(25)");
out.fib25Ms = now() - t;
t = now();
mpLast.runPython("s = 0\nfor i in range(1000000):\n    s += i * i");
out.loop1e6Ms = now() - t;

mpLast.registerJsModule("host", { f: (x) => x + 1, af: async (x) => x + 1, slow: (x) => new Promise((res) => setTimeout(() => res(x), 100)) });
t = now();
mpLast.runPython("import host\nfor i in range(100000):\n    host.f(i)");
out.syncHostCallUs = ((now() - t) * 1000) / 100000;
t = now();
await mpLast.runPythonAsync("import host\nfor i in range(10000):\n    await host.af(i)");
out.asyncHostCallUs = ((now() - t) * 1000) / 10000;
try {
	t = now();
	await mpLast.runPythonAsync("import host, asyncio\nasync def one(i):\n    return await host.slow(i)\nasync def main():\n    return await asyncio.gather(*[one(i) for i in range(1000)])\nr = await main()");
	out.gather1000x100msMs = now() - t;
} catch (e) {
	out.gatherError = String(e).slice(0, 200);
}
try {
	out.modules = mpLast.runPython("import sys\nlst = []\nfor m in ['json','re','datetime','time','asyncio','math','random','hashlib','binascii','collections','io','struct','os','socket','urllib','requests']:\n    try:\n        __import__(m); lst.append(m)\n    except ImportError:\n        pass\n_mods = ','.join(lst)");
	out.modules = mpLast.globals.get('_mods');
} catch (e) {
	out.modulesError = String(e).slice(0, 200);
}
mpLast.runPython("import sys\n_v = sys.version"); out.sysVersion = mpLast.globals.get("_v");
console.log(JSON.stringify(out, null, 1));
process.exit(0);
