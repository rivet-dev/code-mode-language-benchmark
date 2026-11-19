```lua
local metrics = { "cpu", "mem", "disk", "net", "gpu" }
local MAX_ATTEMPTS = 4

local total = 0

for _, name in ipairs(metrics) do
  local attempts = 0
  local succeeded = false
  local value = nil
  local errcode = nil

  while true do
    attempts = attempts + 1
    local ok, res = pcall(tools.fetch_metric, name)
    if ok then
      succeeded = true
      value = res.value
      break
    end

    errcode = (type(res) == "table" and res.code) or "UNKNOWN"
    if errcode ~= "UNAVAILABLE" or attempts >= MAX_ATTEMPTS then
      break
    end
  end

  if succeeded then
    print(string.format("%s ok %s attempts=%d", name, tostring(value), attempts))
    total = total + value
  else
    print(string.format("%s failed %s attempts=%d", name, tostring(errcode), attempts))
  end
end

print("total=" .. tostring(total))
```
