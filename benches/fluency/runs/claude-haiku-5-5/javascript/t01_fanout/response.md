```javascript
const warehouses = await tools.list_warehouses();

const inventories = await Promise.all(
  warehouses.map((id) => tools.get_inventory(id))
);

const totals = new Map();
for (const items of inventories) {
  for (const { sku, qty } of items) {
    totals.set(sku, (totals.get(sku) ?? 0) + qty);
  }
}

const rows = [...totals.entries()]
  .filter(([, total]) => total >= 50)
  .sort(([skuA, totalA], [skuB, totalB]) => {
    if (totalA !== totalB) return totalB - totalA;
    return skuA < skuB ? -1 : skuA > skuB ? 1 : 0;
  });

if (rows.length > 0) {
  console.log(rows.map(([sku, total]) => `${sku} ${total}`).join("\n"));
}
```
