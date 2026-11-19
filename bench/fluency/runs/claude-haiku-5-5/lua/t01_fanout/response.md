```lua
-- Sum stock quantities for each SKU across all warehouses and print
-- the SKUs whose totals are at least 50, sorted by total descending
-- and then by SKU ascending.

local totals = {}

local ok, warehouses = pcall(tools.list_warehouses)
if not ok then
  local err = warehouses
  io.stderr:write("list_warehouses failed: ", tostring(type(err) == "table" and err.message or err), "\n")
  os.exit(1)
end

for _, warehouse_id in ipairs(warehouses or {}) do
  local ok2, items = pcall(tools.get_inventory, warehouse_id)
  if not ok2 then
    local err = items
    io.stderr:write("get_inventory failed for ", tostring(warehouse_id), ": ",
      tostring(type(err) == "table" and err.message or err), "\n")
    os.exit(1)
  end

  -- A warehouse may hold no stock, in which case items may be nil or empty.
  for _, item in ipairs(items or {}) do
    if item.sku ~= nil and item.qty ~= nil then
      totals[item.sku] = (totals[item.sku] or 0) + item.qty
    end
  end
end

local rows = {}
for sku, total in pairs(totals) do
  if total >= 50 then
    rows[#rows + 1] = { sku = sku, total = total }
  end
end

table.sort(rows, function(a, b)
  if a.total ~= b.total then
    return a.total > b.total
  end
  return a.sku < b.sku
end)

for _, row in ipairs(rows) do
  print(string.format("%s %d", row.sku, row.total))
end
```
