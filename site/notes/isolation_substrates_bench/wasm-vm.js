// Measure V8 WebAssembly per-instance virtual reservation vs resident memory and instantiation time.
const fs = require('fs');
function mem() {
  const s = fs.readFileSync('/proc/self/status', 'utf8');
  const g = (k) => +s.match(new RegExp(k + ':\\s+(\\d+)'))[1];
  return { VmSize: g('VmSize'), VmRSS: g('VmRSS'), RssAnon: g('RssAnon') };
}
const bytes = new Uint8Array([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00, 0x01,0x05,0x01,0x60,0x00,0x01,0x7f, 0x03,0x02,0x01,0x00, 0x05,0x03,0x01,0x00,0x01, 0x07,0x09,0x02,0x01,0x6d,0x02,0x00,0x01,0x66,0x00,0x00, 0x0a,0x06,0x01,0x04,0x00,0x41,0x2a,0x0b]);
const mod = new WebAssembly.Module(bytes);
const jspi = typeof WebAssembly.Suspending === 'function' && typeof WebAssembly.promising === 'function';
for (let i = 0; i < 200; i++) new WebAssembly.Instance(mod).exports.f();
globalThis.gc && gc();
const N = +(process.argv[2] || 2000);
let t0 = process.hrtime.bigint();
for (let i = 0; i < 20000; i++) new WebAssembly.Instance(mod);
const instUs = Number(process.hrtime.bigint() - t0) / 1e3 / 20000;
globalThis.gc && gc();
const before = mem();
const live = [];
let failedAt = null;
try {
  for (let i = 0; i < N; i++) {
    const inst = new WebAssembly.Instance(mod);
    new Uint8Array(inst.exports.m.buffer)[0] = 1; // dirty one page
    live.push(inst);
  }
} catch (e) { failedAt = live.length + ': ' + e.message; }
const after = mem();
const n = live.length;
console.log(JSON.stringify({ node: process.version, v8: process.versions.v8, flags: process.execArgv.join(' '), jspi_available: jspi,
  instantiate_us: +instUs.toFixed(2), live: n, failedAt,
  per_instance_VmSize_MiB: +((after.VmSize - before.VmSize) / 1024 / n).toFixed(1),
  per_instance_RSS_KiB: +((after.VmRSS - before.VmRSS) / n).toFixed(1),
  per_instance_RssAnon_KiB: +((after.RssAnon - before.RssAnon) / n).toFixed(1),
  total_VmSize_GiB: +(after.VmSize / 1024 / 1024).toFixed(1) }));
