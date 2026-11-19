local PY, TH = "/home/linuxbrew/.linuxbrew/opt/python@3.15/bin/python3.15", "bench/fluency/toolhost.py"
local function q(s) return "'" .. s:gsub("'", "'\\''") .. "'" end
local function enc(v) if v == nil then return 'null' elseif type(v) == 'number' then return tostring(v) else return '"' .. tostring(v):gsub('["\\]', '\\%0') .. '"' end end
local EM = {__tostring = function(e) return e.code .. ': ' .. e.message end}
local function call(name, n, ...) local a = table.pack(...) local parts = {} for i = 1, n do parts[i] = enc(a[i]) end
  local p = io.popen(PY .. ' -I -S ' .. q(TH) .. ' lua ' .. name .. ' ' .. q('[' .. table.concat(parts, ',') .. ']'), 'r') local out = p:read('a') p:close()
  local e = load('return ' .. out, '=tool', 't', {})() if e.ok then return e.value end error(setmetatable(e.error, EM), 2) end
local tools = {}
function tools.fetch_metric(...) return call('fetch_metric', 1, ...) end
return tools
