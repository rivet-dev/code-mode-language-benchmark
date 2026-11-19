```lua
local ok, text = pcall(tools.read_log)
if not ok then
  io.stderr:write("failed to read log: ", tostring(type(text) == "table" and text.message or text), "\n")
  os.exit(1)
end

-- Converts a duration such as "342ms" to milliseconds. Returns nil if unparseable.
local function to_ms(s)
  local num, unit = s:match("^(%d+%.?%d*)(%a+)$")
  if not num then
    return nil
  end
  local n = tonumber(num)
  if n == nil then
    return nil
  end
  if unit == "ms" then
    return n
  elseif unit == "s" then
    return n * 1000
  elseif unit == "us" then
    return n / 1000
  elseif unit == "ns" then
    return n / 1000000
  end
  return nil
end

local errs = {}          -- component -> { count = n, seen = {}, list = {} }
local best_ms = nil
local best_comp = nil
local best_took = nil

for raw in (text .. "\n"):gmatch("([^\n]*)\n") do
  local line = (raw:gsub("\r$", ""))
  if line:match("%S") then
    local _, level, comp, rest = line:match("^(%S+) (%S+) (%S+): (.*)$")
    if level then
      local msg, kvs = rest:match("^(.-)%s*{([^{}]*)}%s*$")
      if not msg then
        kvs = nil
      end

      local kv = {}
      if kvs then
        for k, v in kvs:gmatch("([^%s=]+)=([^%s=]+)") do
          kv[k] = v
        end
      end

      if level == "ERROR" then
        local e = errs[comp]
        if not e then
          e = { count = 0, seen = {}, list = {} }
          errs[comp] = e
        end
        e.count = e.count + 1
        local code = kv.code
        if code ~= nil and not e.seen[code] then
          e.seen[code] = true
          e.list[#e.list + 1] = code
        end
      end

      if kv.took then
        local ms = to_ms(kv.took)
        if ms ~= nil and (best_ms == nil or ms > best_ms) then
          best_ms = ms
          best_comp = comp
          best_took = kv.took
        end
      end
    end
  end
end

local names = {}
for c in pairs(errs) do
  names[#names + 1] = c
end
table.sort(names)

for _, c in ipairs(names) do
  local e = errs[c]
  table.sort(e.list)
  print(string.format("%s errors=%d codes=%s", c, e.count, table.concat(e.list, ",")))
end

if best_comp ~= nil then
  print("slowest " .. best_comp .. " " .. best_took)
end
```
