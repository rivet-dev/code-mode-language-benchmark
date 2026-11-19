interface Issue { id: number; title: string; labels: string[]; createdAt: string; assignee?: { login: string } | null }
interface ToolResult<T> { ok: boolean; data: T; error?: string }
type Summary = { label: string; count: number; oldest: string };
declare const tools: {
  github: { listIssues(args: { repo: string; state: "open" | "closed"; page: number }): Promise<ToolResult<Issue[]>> };
  slack: { postMessage(args: { channel: string; text: string }): Promise<ToolResult<{ ts: string }>> };
};
async function fetchAll(repo: string, pages: number): Promise<Issue[]> {
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => tools.github.listIssues({ repo, state: "open", page: i + 1 })),
  );
  const out: Issue[] = [];
  for (const r of results) {
    if (!r.ok) throw new Error(`listIssues failed: ${r.error ?? "unknown"}`);
    out.push(...r.data);
  }
  return out;
}
function summarize(issues: Issue[]): Summary[] {
  const byLabel = new Map<string, Issue[]>();
  for (const issue of issues) {
    for (const label of issue.labels) {
      const list = byLabel.get(label) ?? [];
      list.push(issue);
      byLabel.set(label, list);
    }
  }
  return [...byLabel.entries()]
    .map(([label, list]): Summary => ({
      label,
      count: list.length,
      oldest: list.reduce((a, b) => (a.createdAt < b.createdAt ? a : b)).createdAt,
    }))
    .sort((a, b) => b.count - a.count);
}
const repos: readonly string[] = ["org/api", "org/web", "org/infra"] as const;
const all = (await Promise.all(repos.map((r) => fetchAll(r, 3)))).flat();
const unassigned = all.filter((i): i is Issue => !i.assignee);
const top = summarize(all).slice(0, 5);
const text = top.map((s) => `${s.label}: ${s.count} (oldest ${s.oldest.slice(0, 10)})`).join("\n");
await tools.slack.postMessage({ channel: "#triage", text: `Open: ${all.length}, unassigned: ${unassigned.length}\n${text}` });
console.log(JSON.stringify({ total: all.length, top }, null, 2));
