```lua
-- Build breadcrumbs for each open task, fetching each task at most once.
local cache = {}   -- task id -> Task table
local seen = {}    -- task id -> true once get_task has been called for it

local function fetch(id)
  if not seen[id] then
    seen[id] = true
    cache[id] = tools.get_task(id)
  end
  return cache[id]
end

local function breadcrumb(id)
  local titles = {}
  local visited = {}  -- guards against accidental parent cycles
  local cur = id
  while cur ~= nil do
    if visited[cur] then
      break
    end
    visited[cur] = true
    local task = fetch(cur)
    table.insert(titles, 1, task.title)  -- prepend so the root ends up first
    cur = task.parent_id
  end
  return table.concat(titles, " > ")
end

local ids = tools.list_open_tasks()
for _, id in ipairs(ids) do
  io.write(id, ": ", breadcrumb(id), "\n")
end
```
