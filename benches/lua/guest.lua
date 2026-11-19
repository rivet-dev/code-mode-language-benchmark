-- Sandbox side of the tool-call benchmark for Lua and LuaJIT: one call at a time over stdio.
-- Lua has no JSON library built in, so it formats the call and pattern-matches the reply's id.
local calls, warmup, batch = tonumber(arg[1]), tonumber(arg[2]), tonumber(arg[3])
local write, read, flush = io.write, io.read, io.flush

for id = 0, warmup + calls - 1 do
	if id >= warmup and (id - warmup) % batch == 0 then
		write("mark\n")
	end
	write('{"id":', id, ',"tool":"lookup","args":{"s":"hello from the sandbox"}}\n')
	flush()
	local reply = read("*l")
	if tonumber(reply:match('"id":(%d+)')) ~= id then
		error("reply mismatch")
	end
end

write("mark\ndone\n")
flush()
read("*a")
