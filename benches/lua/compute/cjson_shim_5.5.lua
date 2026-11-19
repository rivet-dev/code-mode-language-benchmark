-- Exposes lua-cjson, a C extension, as json.decode and json.encode for the task.
-- benches/lua/run.mjs builds cjson.so from source into benches/lua/build/cjson-5.5/; the path is
-- found relative to this file, so the shim works from any working directory.
local here = debug.getinfo(1, "S").source:match("^@(.*[/\\])") or "./"
package.cpath = here .. "../build/cjson-5.5/?.so;" .. package.cpath
local cjson = require("cjson")
return { decode = cjson.decode, encode = cjson.encode }
