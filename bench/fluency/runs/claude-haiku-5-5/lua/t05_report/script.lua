-- Fetch invoice INV-2041 and print it in the fixed report layout.
-- All money is handled as integer cents to avoid floating-point rounding errors.

-- Convert a number to an integer, rounding to the nearest whole value if needed.
local function toint(v)
  return math.tointeger(v) or math.floor(v + 0.5)
end

-- Integer division of n by d, rounding half away from zero.
local function round_div(n, d)
  local half = d // 2
  if n >= 0 then
    return (n + half) // d
  else
    return -((-n + half) // d)
  end
end

-- Format integer cents as dollars with exactly two decimals (e.g. 4750 -> "47.50").
local function money(cents)
  local sign = cents < 0 and "-" or ""
  local a = math.abs(cents)
  return string.format("%s%d.%02d", sign, a // 100, a % 100)
end

-- Fetch the invoice, reporting any failure on stderr and exiting.
local ok, inv = pcall(tools.get_invoice, "INV-2041")
if not ok then
  local msg = type(inv) == "table" and (inv.message or inv.code) or tostring(inv)
  io.stderr:write("error: could not fetch INV-2041: " .. tostring(msg) .. "\n")
  os.exit(1)
end

local out = {}
out[#out + 1] = string.format("Invoice %s for %s", tostring(inv.id), tostring(inv.customer))

local subtotal = 0
for _, line in ipairs(inv.lines or {}) do
  local qty = toint(line.quantity)
  local price = toint(line.unit_price_cents)
  local total = qty * price
  subtotal = subtotal + total
  out[#out + 1] = string.format("%-14s%3d %9s", tostring(line.description), qty, money(total))
end

local tax_bp = toint(inv.tax_bp or 0)
local tax = round_div(subtotal * tax_bp, 10000)
local total = subtotal + tax

out[#out + 1] = string.format("%-18s%9s", "Subtotal", money(subtotal))
out[#out + 1] = string.format("%-18s%9s", "Tax", money(tax))
out[#out + 1] = string.format("%-18s%9s", "Total", money(total))

print(table.concat(out, "\n"))
