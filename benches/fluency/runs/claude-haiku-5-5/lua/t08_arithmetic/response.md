```lua
local rates = tools.get_rates()
local expenses = tools.list_expenses()
local rateTable = rates.rates or {}

-- Convert an expense amount to EUR (unrounded).
local function toEur(e)
  local amt = tonumber(e.amount)
  if e.currency == "EUR" then
    return amt
  end
  local r = tonumber(rateTable[e.currency])
  if not r or r == 0 then
    error("missing rate for currency " .. tostring(e.currency))
  end
  return amt / r
end

local catTotals = {}
local catOrder = {}
local total = 0
local maxId, maxVal = nil, nil

for _, e in ipairs(expenses) do
  local v = toEur(e)
  local c = e.category
  if catTotals[c] == nil then
    catTotals[c] = 0
    catOrder[#catOrder + 1] = c
  end
  catTotals[c] = catTotals[c] + v
  total = total + v
  if maxVal == nil or v > maxVal then
    maxVal = v
    maxId = e.id
  end
end

table.sort(catOrder)

local out = {}
for _, c in ipairs(catOrder) do
  out[#out + 1] = string.format("%s %.2f", c, catTotals[c])
end
out[#out + 1] = string.format("TOTAL %.2f", total)
if maxId ~= nil then
  out[#out + 1] = string.format("MAX %s %.2f", tostring(maxId), maxVal)
end

print(table.concat(out, "\n"))
```
