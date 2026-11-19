-- Process runner for lua and luajit: loop inside the runtime. Standard Lua has no wall clock
-- finer than a second, so this uses os.clock() (process CPU time, microsecond resolution).
local taskPath, dataPath, jsonPath, warm, measured = arg[1], arg[2], arg[3], tonumber(arg[4]), tonumber(arg[5])
json = dofile(jsonPath)
dofile(taskPath)
local handle = assert(io.open(dataPath, "rb"))
local text = handle:read("*a")
handle:close()
local samples, first, same = {}, nil, true
for i = 1, warm + measured do
  local t0 = os.clock()
  local out = run(text)
  local ms = (os.clock() - t0) * 1000
  if first == nil then first = out elseif out ~= first then same = false end
  if i > warm then samples[#samples + 1] = string.format("%.4f", ms) end
end
print("SAMPLES " .. table.concat(samples, ","))
print("SAME " .. tostring(same))
print("RESULT " .. first)
