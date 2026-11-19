// Measures V8 heap bytes retained per suspended async function awaiting a pending promise.
const N = 200000;
function heap() { global.gc(); global.gc(); return process.memoryUsage().heapUsed; }
const never = new Promise(() => {});
let h0 = heap();
const a = [];
async function f(i) { const x = i; await never; return x; }
for (let i = 0; i < N; i++) a.push(f(i));
let h1 = heap();
console.log(JSON.stringify({ case: "async fn awaiting shared pending promise", bytes_per: Math.round((h1 - h0) / N) }));
const resolvers = [];
h0 = heap();
const b = [];
async function g(i) { const x = i; const v = await new Promise((r) => resolvers.push(r)); return v + x; }
for (let i = 0; i < N; i++) b.push(g(i));
h1 = heap();
console.log(JSON.stringify({ case: "async fn awaiting own host-held promise (+resolver closure)", bytes_per: Math.round((h1 - h0) / N) }));
h0 = heap();
const c = [];
for (let i = 0; i < N; i++) c.push(new Promise((r) => resolvers.push(r)));
h1 = heap();
console.log(JSON.stringify({ case: "bare pending promise + resolver", bytes_per: Math.round((h1 - h0) / N) }));
console.log(JSON.stringify({ node: process.version, v8: process.versions.v8 }));
