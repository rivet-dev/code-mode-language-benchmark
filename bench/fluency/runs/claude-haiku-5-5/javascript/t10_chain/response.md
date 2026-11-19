```javascript
// Builds breadcrumbs for each open task. Each task is fetched at most once.
const cache = new Map();

function getTask(id) {
  if (!cache.has(id)) {
    cache.set(id, tools.get_task(id));
  }
  return cache.get(id);
}

const openIds = await tools.list_open_tasks();
const lines = [];

for (const id of openIds) {
  const titles = [];
  const visited = new Set();
  let current = await getTask(id);

  while (true) {
    titles.push(current.title);
    visited.add(current.id);
    if (current.parent_id == null) break;      // reached the root
    if (visited.has(current.parent_id)) break; // guard against cycles
    current = await getTask(current.parent_id);
  }

  lines.push(`${id}: ${titles.reverse().join(' > ')}`);
}

console.log(lines.join('\n'));
```
