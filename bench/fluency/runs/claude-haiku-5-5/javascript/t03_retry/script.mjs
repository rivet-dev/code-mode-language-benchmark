const names = ['cpu', 'mem', 'disk', 'net', 'gpu'];
const lines = [];
let total = 0;

for (const name of names) {
  let attempts = 0;
  let line;
  while (true) {
    attempts++;
    try {
      const metric = await tools.fetch_metric(name);
      total += metric.value;
      line = `${name} ok ${metric.value} attempts=${attempts}`;
      break;
    } catch (err) {
      const code = err?.code ?? 'UNKNOWN';
      if (code === 'UNAVAILABLE' && attempts < 4) {
        continue;
      }
      line = `${name} failed ${code} attempts=${attempts}`;
      break;
    }
  }
  lines.push(line);
}

lines.push(`total=${total}`);
console.log(lines.join('\n'));
