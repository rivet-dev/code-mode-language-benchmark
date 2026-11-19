```lua
local hosts = tools.list_hosts()

-- Lua has no true concurrency for these synchronous host calls, so probe
-- sequentially. This keeps in-flight calls at 1, within the limit of 3.
local healthy = 0
local max_latency = 0
local bad = {}

for _, host in ipairs(hosts) do
  local ok, res = pcall(tools.probe, host)
  if ok and type(res) == "table" then
    if res.status == 200 then
      healthy = healthy + 1
      if res.latency_ms > max_latency then
        max_latency = res.latency_ms
      end
    else
      bad[#bad + 1] = { host = host, status = res.status }
    end
  else
    local code = type(res) == "table" and res.code or tostring(res)
    bad[#bad + 1] = { host = host, status = code }
  end
end

table.sort(bad, function(a, b) return a.host < b.host end)

for _, entry in ipairs(bad) do
  print(entry.host .. " " .. tostring(entry.status))
end

print(string.format("healthy=%d max_latency=%d", healthy, max_latency))
```
