// probe-hosts.mjs
const hosts = await tools.list_hosts();

const results = new Array(hosts.length);
let nextIndex = 0;

async function worker() {
  while (nextIndex < hosts.length) {
    const i = nextIndex++;
    const host = hosts[i];
    try {
      const r = await tools.probe(host);
      results[i] = { host, status: r.status, latency_ms: r.latency_ms };
    } catch (e) {
      results[i] = { host, status: e?.code ?? "ERROR", latency_ms: 0 };
    }
  }
}

// At most 3 probe calls in flight at any moment.
await Promise.all([worker(), worker(), worker()]);

const compareStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const failing = results
  .filter((r) => r.status !== 200)
  .sort((a, b) => compareStr(a.host, b.host));

const healthy = results.filter((r) => r.status === 200);
const maxLatency =
  healthy.length > 0 ? Math.max(...healthy.map((r) => r.latency_ms)) : 0;

const lines = failing.map((r) => `${r.host} ${r.status}`);
lines.push(`healthy=${healthy.length} max_latency=${maxLatency}`);

console.log(lines.join("\n"));
