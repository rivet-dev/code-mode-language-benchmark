```javascript
const { rates } = await tools.get_rates();
const expenses = await tools.list_expenses();

function toEur(e) {
  if (e.currency === "EUR") return e.amount;
  const r = rates[e.currency];
  if (typeof r !== "number" || !Number.isFinite(r) || r === 0) {
    throw new Error(`missing or invalid rate for currency ${e.currency}`);
  }
  return e.amount / r;
}

const categoryTotals = new Map();
let total = 0;
let maxId = null;
let maxAmount = -Infinity;

for (const e of expenses) {
  const eur = toEur(e);
  categoryTotals.set(e.category, (categoryTotals.get(e.category) ?? 0) + eur);
  total += eur;
  if (maxId === null || eur > maxAmount) {
    maxId = e.id;
    maxAmount = eur;
  }
}

const lines = [];
for (const category of [...categoryTotals.keys()].sort()) {
  lines.push(`${category} ${categoryTotals.get(category).toFixed(2)}`);
}
lines.push(`TOTAL ${total.toFixed(2)}`);
if (maxId !== null) {
  lines.push(`MAX ${maxId} ${maxAmount.toFixed(2)}`);
}

console.log(lines.join("\n"));
```
