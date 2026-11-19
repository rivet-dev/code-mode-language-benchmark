-- Exposes lua-cjson, a C extension, as json.decode and json.encode for the task.
package.cpath = "bench/compute/vendor/cjson-5.5/?.so;" .. package.cpath
local cjson = require("cjson")
return { decode = cjson.decode, encode = cjson.encode }
