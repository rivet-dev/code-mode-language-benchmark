```lua
local ok, employees = pcall(tools.list_employees)
if not ok then
  if type(employees) == "table" then
    io.stderr:write(tostring(employees.code), ": ", tostring(employees.message), "\n")
  else
    io.stderr:write(tostring(employees), "\n")
  end
  os.exit(1)
end

local groups = {}
for _, e in ipairs(employees) do
  if e.active == true
     and type(e.hired) == "string" and e.hired >= "2021-01-01"
     and e.dept ~= nil and e.name ~= nil and e.salary ~= nil then
    local g = groups[e.dept]
    if not g then
      g = { dept = e.dept, names = {}, total = 0, count = 0 }
      groups[e.dept] = g
    end
    g.count = g.count + 1
    g.total = g.total + e.salary
    g.names[#g.names + 1] = e.name
  end
end

local list = {}
for _, g in pairs(groups) do
  list[#list + 1] = g
end

table.sort(list, function(a, b)
  if a.count ~= b.count then
    return a.count > b.count
  end
  return a.dept < b.dept
end)

for _, g in ipairs(list) do
  table.sort(g.names)
  local avg = g.total // g.count
  print(string.format("%s count=%d avg_salary=%d names=%s",
    g.dept, g.count, avg, table.concat(g.names, ",")))
end
```
