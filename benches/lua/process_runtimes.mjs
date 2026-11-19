// Lua and LuaJIT run as separate processes, for the shared process suite (benches/common).
// Each idle command answers 1 + 1 and then waits for stdin to close.
import path from "node:path";
import { fileURLToPath } from "node:url";

const guest = path.join(path.dirname(fileURLToPath(import.meta.url)), "guest.lua");
const idle = "io.write(1 + 1, '\\n') io.stdout:flush() io.read('*a')";

export const PROCESS_RUNTIMES = [
	{ key: "lua-process", idle: ["lua", ["-e", idle]], guest: ["lua", [guest]] },
	{ key: "luajit-process", idle: ["luajit", ["-e", idle]], guest: ["luajit", [guest]] },
];
