const fs = require("fs");
const src = fs.readFileSync(process.argv[3], "utf8");
const which = process.argv[2];
const t0 = process.hrtime.bigint();
let fn;
if (which === "node-strip") { const m = require("node:module"); fn = (s) => m.stripTypeScriptTypes(s); }
else if (which === "amaro") { const a = require("amaro"); fn = (s) => a.transformSync(s, { mode: "strip-only" }).code; }
else if (which === "oxc") { const o = require("oxc-transform"); fn = (s) => o.transformSync("a.ts", s, { typescript: { onlyRemoveTypeImports: false } }).code; }
else if (which === "swc") { const w = require("@swc/core"); fn = (s) => w.transformSync(s, { filename: "a.ts", jsc: { parser: { syntax: "typescript" }, target: "es2022" }, module: { type: "es6" } }).code; }
else if (which === "sucrase") { const su = require("sucrase"); fn = (s) => su.transform(s, { transforms: ["typescript"], disableESTransforms: true }).code; }
else if (which === "esbuild") { const e = require("esbuild"); fn = (s) => e.transformSync(s, { loader: "ts", format: "esm" }).code; }
else if (which === "ts-blank-space") { const b = require("ts-blank-space"); fn = (s) => (b.default || b)(s); }
else if (which === "typescript") { const ts = require("typescript"); fn = (s) => ts.transpileModule(s, { compilerOptions: { target: 99, module: 99 } }).outputText; }
const out1 = fn(src);
const t1 = process.hrtime.bigint();
const N = 2000; const ts = [];
for (let i = 0; i < N; i++) { const a = process.hrtime.bigint(); fn(src); ts.push(Number(process.hrtime.bigint() - a) / 1e3); }
ts.sort((a, b) => a - b);
const ok = !/interface |: Promise<|readonly string/.test(out1);
console.log(`${which.padEnd(15)} cold(load+1st)=${(Number(t1 - t0) / 1e6).toFixed(1)}ms  warm median=${ts[N >> 1].toFixed(1)}us p99=${ts[Math.floor(N * 0.99)].toFixed(1)}us  rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB typesRemoved=${ok}`);
