const ivm = require("isolated-vm");
function rss() { global.gc(); return process.memoryUsage().rss; }
const K = 100;
let r0 = rss(), t0 = process.hrtime.bigint();
const isolates = [];
for (let i = 0; i < K; i++) { const iso = new ivm.Isolate({ memoryLimit: 128 }); const ctx = iso.createContextSync(); ctx.evalSync("1+1"); isolates.push([iso, ctx]); }
let t1 = process.hrtime.bigint(); let r1 = rss();
console.log(JSON.stringify({ case: "isolated-vm new Isolate + context + eval", n: K, ms_per: Number(t1 - t0) / 1e6 / K, rss_kb_per: Math.round((r1 - r0) / 1024 / K), heap_kb_per_isolate: Math.round(isolates[0][0].getHeapStatisticsSync().used_heap_size / 1024) }));
const iso = new ivm.Isolate({ memoryLimit: 512 });
const M = 500;
r0 = rss(); t0 = process.hrtime.bigint();
const ctxs = [];
for (let i = 0; i < M; i++) { const c = iso.createContextSync(); c.evalSync("1+1"); ctxs.push(c); }
t1 = process.hrtime.bigint(); r1 = rss();
console.log(JSON.stringify({ case: "isolated-vm new context in existing isolate", n: M, ms_per: Number(t1 - t0) / 1e6 / M, rss_kb_per: Math.round((r1 - r0) / 1024 / M), isolate_heap_used_kb: Math.round(iso.getHeapStatisticsSync().used_heap_size / 1024) }));
// pending awaits inside an isolate, waiting on host promises
(async () => {
  const iso2 = new ivm.Isolate({ memoryLimit: 512 });
  const ctx = await iso2.createContext();
  const pending = [];
  await ctx.global.set("hostRef", new ivm.Reference((i) => new Promise((r) => pending.push(r))));
  const h0 = iso2.getHeapStatisticsSync().used_heap_size;
  const N = 20000;
  ctx.evalIgnored(`globalThis.out = []; for (let i = 0; i < ${N}; i++) { (async () => { const v = await hostRef.apply(undefined, [i], { arguments: { copy: true }, result: { promise: true, copy: true } }); out.push(v); })(); }`);
  await new Promise((r) => setTimeout(r, 500));
  const h1 = iso2.getHeapStatisticsSync().used_heap_size;
  console.log(JSON.stringify({ case: "isolated-vm guest async fn awaiting host Callback promise", n: N, guest_heap_bytes_per: Math.round((h1 - h0) / N), host_pending: pending.length }));
  const t0 = process.hrtime.bigint();
  for (const r of pending) r(1);
  const until = Date.now() + 10000;
  while ((await ctx.eval("out.length", { copy: true })) < N && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
  const t1 = process.hrtime.bigint();
  console.log(JSON.stringify({ case: "isolated-vm resolve N host promises -> guest continuations", n: N, total_ms: Number(t1 - t0) / 1e6 }));
  // sync host call round trip cost
  await ctx.global.set("hostSync", new ivm.Callback((x) => x + 1));
  const s0 = process.hrtime.bigint();
  ctx.evalSync(`let s = 0; for (let i = 0; i < 100000; i++) s = hostSync(s);`);
  const s1 = process.hrtime.bigint();
  console.log(JSON.stringify({ case: "isolated-vm sync Callback round trip", n: 100000, us_per: Number(s1 - s0) / 1e3 / 100000 }));
  console.log(JSON.stringify({ ivm: require("isolated-vm/package.json").version, node: process.version }));
  process.exit(0);
})();
