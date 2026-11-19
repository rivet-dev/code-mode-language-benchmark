```javascript
const counts = new Map();
let total = 0;
let cursor = null;

do {
  const page = cursor === null
    ? await tools.list_events()
    : await tools.list_events(cursor);

  for (const ev of page.events) {
    total++;
    if (ev.action === "delete") {
      counts.set(ev.user, (counts.get(ev.user) ?? 0) + 1);
    }
  }

  cursor = page.next_cursor;
} while (cursor !== null);

const rows = [...counts.entries()].sort((a, b) => {
  if (b[1] !== a[1]) return b[1] - a[1];
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
});

const lines = [String(total)];
for (const [user, n] of rows) {
  lines.push(`${user} ${n}`);
}
console.log(lines.join("\n"));
```
