const employees = await tools.list_employees();

const groups = new Map();

for (const e of employees) {
  if (e.active !== true) continue;
  if (!(typeof e.hired === "string" && e.hired >= "2021-01-01")) continue;

  if (!groups.has(e.dept)) groups.set(e.dept, []);
  groups.get(e.dept).push(e);
}

const rows = [...groups.entries()].map(([dept, list]) => {
  const total = list.reduce((sum, e) => sum + e.salary, 0);
  const avg = Math.floor(total / list.length);
  const names = list.map((e) => e.name).sort();
  return { dept, count: list.length, avg, names };
});

rows.sort((a, b) => {
  if (b.count !== a.count) return b.count - a.count;
  return a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : 0;
});

const lines = rows.map(
  (r) =>
    `${r.dept} count=${r.count} avg_salary=${r.avg} names=${r.names.join(",")}`
);

console.log(lines.join("\n"));
