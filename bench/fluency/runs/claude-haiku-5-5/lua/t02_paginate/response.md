```lua
local total = 0
local deletes = {}
local cursor = nil

repeat
  local page = tools.list_events(cursor)
  local events = page.events or {}
  for _, ev in ipairs(events) do
    total = total + 1
    if ev.action == "delete" then
      deletes[ev.user] = (deletes[ev.user] or 0) + 1
    end
  end
  cursor = page.next_cursor
until cursor == nil

local rows = {}
for user, n in pairs(deletes) do
  rows[#rows + 1] = { user = user, n = n }
end

table.sort(rows, function(a, b)
  if a.n ~= b.n then
    return a.n > b.n
  end
  return a.user < b.user
end)

print(total)
for _, r in ipairs(rows) do
  print(r.user .. " " .. r.n)
end
```
