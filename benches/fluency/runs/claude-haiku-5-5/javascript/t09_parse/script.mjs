const text = await tools.read_log();

const errorStats = new Map(); // component -> { count, codes: Set }
let slowestMs = -1;
let slowestComponent = null;
let slowestTook = null;

for (const rawLine of text.split('\n')) {
  const line = rawLine.replace(/\r$/, '').trim();
  if (line === '') continue;

  const m = line.match(/^(\S+)\s+(\S+)\s+(\S+?):\s(.*)$/);
  if (!m) continue;
  const level = m[2];
  const component = m[3];

  // Optional trailing {key=value ...} block
  const kv = {};
  const km = line.match(/\{([^{}]*)\}$/);
  if (km) {
    for (const tok of km[1].split(/\s+/)) {
      if (tok === '') continue;
      const idx = tok.indexOf('=');
      if (idx < 0) continue;
      kv[tok.slice(0, idx)] = tok.slice(idx + 1);
    }
  }

  if (level === 'ERROR') {
    let stats = errorStats.get(component);
    if (!stats) {
      stats = { count: 0, codes: new Set() };
      errorStats.set(component, stats);
    }
    stats.count++;
    if (kv.code !== undefined) stats.codes.add(kv.code);
  }

  if (kv.took !== undefined) {
    const tm = kv.took.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
    if (tm) {
      const ms = parseFloat(tm[1]) * (tm[2] === 's' ? 1000 : 1);
      if (ms > slowestMs) {
        slowestMs = ms;
        slowestComponent = component;
        slowestTook = kv.took;
      }
    }
  }
}

const out = [];
const components = [...errorStats.keys()].sort();
for (const c of components) {
  const s = errorStats.get(c);
  const codes = [...s.codes].sort().join(',');
  out.push(`${c} errors=${s.count} codes=${codes}`);
}
if (slowestComponent !== null) {
  out.push(`slowest ${slowestComponent} ${slowestTook}`);
}

console.log(out.join('\n'));
