import { getQuickJS, newQuickJSAsyncWASMModule } from "quickjs-emscripten";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
function rss() { global.gc(); return process.memoryUsage().rss; }
const QuickJS = await getQuickJS();
const K = 500;
let r0 = rss(), t0 = process.hrtime.bigint();
const rts = [];
for (let i = 0; i < K; i++) { const rt = QuickJS.newRuntime(); rt.setMemoryLimit(64 << 20); const vm = rt.newContext(); vm.unwrapResult(vm.evalCode("1+1")).dispose(); rts.push([rt, vm]); }
let t1 = process.hrtime.bigint(), r1 = rss();
const mu = rts[0][0].computeMemoryUsage(); const dump = rts[0][0].dumpMemoryUsage(); mu.dispose();
console.log(JSON.stringify({ case: "quickjs-emscripten (sync, Bellard) new runtime+context+eval", n: K, ms_per: Number(t1 - t0) / 1e6 / K, rss_kb_per: Math.round((r1 - r0) / 1024 / K) }));
console.log(dump.split("\n").slice(0, 6).join(" | "));
const rt = QuickJS.newRuntime();
const M = 1000; r0 = rss(); t0 = process.hrtime.bigint();
const cs = []; for (let i = 0; i < M; i++) { const c = rt.newContext(); cs.push(c); }
t1 = process.hrtime.bigint(); r1 = rss();
console.log(JSON.stringify({ case: "quickjs-emscripten new context in existing runtime", n: M, ms_per: Number(t1 - t0) / 1e6 / M, rss_kb_per: Math.round((r1 - r0) / 1024 / M) }));
// pending awaits on host promises inside one QuickJS context
const vm = QuickJS.newContext();
const pend = [];
const fn = vm.newFunction("hostCall", (x) => { const d = vm.newPromise(); pend.push(d); d.settled.then(vm.runtime.executePendingJobs); return d.handle; });
vm.setProp(vm.global, "hostCall", fn); fn.dispose();
const N = 20000;
const before = vm.runtime.computeMemoryUsage(); const b = vm.getNumber(vm.getProp(before, "memory_used_size")); before.dispose();
vm.unwrapResult(vm.evalCode(`globalThis.out=[]; for (let i=0;i<${N};i++){ (async()=>{ const v = await hostCall(i); out.push(v); })(); }`)).dispose();
const after = vm.runtime.computeMemoryUsage(); const a = vm.getNumber(vm.getProp(after, "memory_used_size")); after.dispose();
console.log(JSON.stringify({ case: "quickjs guest async fn awaiting host promise (bytes in QuickJS heap)", n: N, bytes_per: Math.round((a - b) / N) }));
let t2 = process.hrtime.bigint();
for (const d of pend) { const one = vm.newNumber(1); d.resolve(one); one.dispose(); }
vm.runtime.executePendingJobs();
let t3 = process.hrtime.bigint();
const len = vm.getNumber(vm.unwrapResult(vm.evalCode("out.length")));
console.log(JSON.stringify({ case: "quickjs resolve N host promises + run jobs", n: N, total_ms: Number(t3 - t2) / 1e6, completed: len }));
// sync host call round trip
const inc = vm.newFunction("hostSync", (x) => vm.newNumber(vm.getNumber(x) + 1)); vm.setProp(vm.global, "hostSync", inc); inc.dispose();
t2 = process.hrtime.bigint(); vm.unwrapResult(vm.evalCode(`let s=0; for (let i=0;i<100000;i++) s=hostSync(s); s`)).dispose(); t3 = process.hrtime.bigint();
console.log(JSON.stringify({ case: "quickjs-emscripten sync host fn round trip", n: 100000, us_per: Number(t3 - t2) / 1e3 / 100000 }));
// asyncify variant: each async runtime instantiates its own wasm module
const A = 20; r0 = rss(); t0 = process.hrtime.bigint(); const ams = [];
for (let i = 0; i < A; i++) { const m = await newQuickJSAsyncWASMModule(); const c = m.newContext(); c.unwrapResult(c.evalCode("1+1")).dispose(); ams.push([m, c]); }
t1 = process.hrtime.bigint(); r1 = rss();
console.log(JSON.stringify({ case: "quickjs-emscripten asyncify: new wasm module+context", n: A, ms_per: Number(t1 - t0) / 1e6 / A, rss_kb_per: Math.round((r1 - r0) / 1024 / A) }));
console.log(JSON.stringify({ qe: require("quickjs-emscripten/package.json").version, node: process.version }));
