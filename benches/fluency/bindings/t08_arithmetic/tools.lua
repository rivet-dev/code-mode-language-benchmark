local PY, TH = "python3", "benches/fluency/toolhost.py"
local function q(s) return "'" .. s:gsub("'", "'\\''") .. "'" end
local function enc(v) if v == nil then return 'null' elseif type(v) == 'number' then return tostring(v) else return '"' .. tostring(v):gsub('["\\]', '\\%0') .. '"' end end
local EM = {__tostring = function(e) return e.code .. ': ' .. e.message end}
local function call(name, n, ...) local a = table.pack(...) local parts = {} for i = 1, n do parts[i] = enc(a[i]) end
  local p = io.popen(PY .. ' -I -S ' .. q(TH) .. ' lua ' .. name .. ' ' .. q('[' .. table.concat(parts, ',') .. ']'), 'r') local out = p:read('a') p:close()
  local e = load('return ' .. out, '=tool', 't', {})() if e.ok then return e.value end error(setmetatable(e.error, EM), 2) end
local tools = {}
function tools.get_rates(...) return call('get_rates', 0, ...) end
function tools.list_expenses(...) return call('list_expenses', 0, ...) end
return tools
