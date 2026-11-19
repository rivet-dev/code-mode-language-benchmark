-- Expects the global `json` with decode and encode: lua-cjson, loaded through cjson_shim_*.lua.
function run(text)
  local orders = json.decode(text)
  local byRegion, byCustomer = {}, {}
  local ordersWithMoreThan3Items = 0
  for _, order in ipairs(orders) do
    local items = order.items
    if #items > 3 then ordersWithMoreThan3Items = ordersWithMoreThan3Items + 1 end
    local total = 0.0
    for _, item in ipairs(items) do total = total + item.qty * item.price end
    byRegion[order.region] = (byRegion[order.region] or 0) + total
    byCustomer[order.customer] = (byCustomer[order.customer] or 0) + total
  end
  local function cents(x) return math.floor(x * 100 + 0.5) / 100 end
  local revenueByRegion = {}
  for region, total in pairs(byRegion) do revenueByRegion[region] = cents(total) end
  local ranked = {}
  for customer, total in pairs(byCustomer) do ranked[#ranked + 1] = { customer = customer, revenue = total } end
  table.sort(ranked, function(a, b)
    if a.revenue ~= b.revenue then return a.revenue > b.revenue end
    return a.customer < b.customer
  end)
  local topCustomers = {}
  for i = 1, 5 do topCustomers[i] = { customer = ranked[i].customer, revenue = cents(ranked[i].revenue) } end
  return json.encode({ revenueByRegion = revenueByRegion, topCustomers = topCustomers, ordersWithMoreThan3Items = ordersWithMoreThan3Items })
end
