// Lua and LuaJIT, embedded in a C host and run as separate processes.
//
// Builds into build/ (ignored by git): the C host lua_bench.c, linked once against the static
// Lua 5.5 library and once against LuaJIT, and lua-cjson from its release source for both.
// Then measures, one after another:
//   embedded: lua_bench for each library, in a memory-accounted scope;
//   processes: the shared process suite and cgroup memory (kept in the results, not charted);
//   compute: the lua and luajit CLIs running the same interpreter and task an embedded state would
//            use, parsing with lua-cjson. The embedded and process rows share this measurement.
//
// Set LUA_PREFIX to the prefix holding include/lua, include/luajit-2.1, lib/liblua.a and
// lib/libluajit.a; it defaults to the prefix of the lua binary on PATH.
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_PATH, runCompute } from "../common/compute/run.mjs";
import { MEMORY_CGROUP, MEMORY_SCOPE, SUITE, build, bytes, firstLine, runHarness, writeRaw, writeResult } from "../common/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(here, "build");
const RUNTIMES_MODULE = path.join(here, "process_runtimes.mjs");
const CJSON = {
	version: "2.1.0.20",
	url: "https://github.com/openresty/lua-cjson/archive/refs/tags/2.1.0.20.tar.gz",
	sha256: "a99fb872aa731274ac70453cd4e6b2e0e8fb978893063d512ca67c7c332510e1",
};

/** Finds the install prefix of the Lua and LuaJIT headers and static libraries. */
function luaPrefix() {
	const which = spawnSync("sh", ["-c", "command -v lua"], { encoding: "utf8" }).stdout.trim();
	const prefix = process.env.LUA_PREFIX ?? (which ? path.dirname(path.dirname(which)) : "");
	for (const file of ["include/lua/lua.h", "include/luajit-2.1/lua.h", "lib/liblua.a", "lib/libluajit.a"]) {
		if (!fs.existsSync(path.join(prefix, file))) throw new Error(`missing ${file} under the Lua prefix; set LUA_PREFIX`);
	}
	return prefix;
}

/** Downloads the pinned lua-cjson release once, checks its hash, and unpacks it into build/. */
function cjsonSource() {
	const source = path.join(BUILD, `lua-cjson-${CJSON.version}`);
	if (fs.existsSync(path.join(source, "lua_cjson.c"))) return source;
	const tarball = path.join(BUILD, `lua-cjson-${CJSON.version}.tar.gz`);
	if (!fs.existsSync(tarball)) build("curl", ["-fsSL", "-o", tarball, CJSON.url]);
	const digest = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
	if (digest !== CJSON.sha256) throw new Error(`lua-cjson tarball hash ${digest} does not match ${CJSON.sha256}`);
	build("tar", ["xzf", tarball, "-C", BUILD]);
	return source;
}

// Build the C hosts and the cjson modules. Both are cheap, so they are rebuilt every run.
fs.mkdirSync(BUILD, { recursive: true });
const prefix = luaPrefix();
const hosts = {
	lua: { binary: path.join(BUILD, "lua55_bench"), include: "include/lua", library: "lib/liblua.a" },
	luajit: { binary: path.join(BUILD, "luajit_bench"), include: "include/luajit-2.1", library: "lib/libluajit.a" },
};
for (const host of Object.values(hosts)) {
	build("gcc", ["-O2", "-o", host.binary, path.join(here, "lua_bench.c"), `-I${path.join(prefix, host.include)}`, path.join(prefix, host.library), "-lm", "-ldl"]);
}
const cjson = cjsonSource();
for (const [variant, include] of [["5.5", "include/lua"], ["luajit", "include/luajit-2.1"]]) {
	fs.mkdirSync(path.join(BUILD, `cjson-${variant}`), { recursive: true });
	const sources = ["lua_cjson.c", "strbuf.c", "fpconv.c"].map((file) => path.join(cjson, file));
	build("gcc", ["-O3", "-Wall", "-pedantic", "-DNDEBUG", "-fpic", "-shared", `-I${path.join(prefix, include)}`, "-o", path.join(BUILD, `cjson-${variant}/cjson.so`), ...sources]);
}

const gcc = `gcc ${firstLine("gcc", ["--version"]).split(" ").at(-1)}`;
const luaVersion = firstLine("lua", ["-v"]).match(/^Lua [\d.]+/)[0];
const luajitVersion = firstLine("luajit", ["-v"]).match(/^LuaJIT [\d.]+/)[0];

// Embedded: one run of the C host per library, inside a memory-accounted scope so the run also
// reports the cgroup charge per state next to resident growth.
const embedded = {};
for (const [key, host] of Object.entries(hosts)) {
	embedded[key] = runHarness(`lua_bench ${key}`, MEMORY_SCOPE[0], [...MEMORY_SCOPE.slice(1), host.binary]);
	writeRaw("lua", `embedded-${key}`, embedded[key]);
}

// Processes: start, USS and tool calls, then cgroup memory in its own scope.
const suite = runHarness("process suite", process.execPath, [SUITE, RUNTIMES_MODULE]);
writeRaw("lua", "process-suite", suite);
const memory = runHarness("process memory", MEMORY_SCOPE[0], [...MEMORY_SCOPE.slice(1), process.execPath, MEMORY_CGROUP, RUNTIMES_MODULE]);
writeRaw("lua", "process-memory", memory);

// Compute: the CLIs with lua-cjson.
const computeRun = path.join(here, "compute/run.lua");
const task = path.join(here, "compute/task.lua");
const compute = runCompute([
	{ key: "lua", command: "lua", args: [computeRun, task, DATA_PATH, path.join(here, "compute/cjson_shim_5.5.lua")] },
	{ key: "luajit", command: "luajit", args: [computeRun, task, DATA_PATH, path.join(here, "compute/cjson_shim_luajit.lua")] },
]);
writeRaw("lua", "compute", { output: compute, started: compute.entries.lua.started, finished: compute.entries.luajit.finished });

const ROWS = [
	{ key: "lua", label: "Lua", version: luaVersion, library: "liblua.a", processKey: "lua-process", processLabel: "Lua (process)" },
	{ key: "luajit", label: "LuaJIT", version: luajitVersion, library: "libluajit.a", processKey: "luajit-process", processLabel: "LuaJIT (process)" },
];
const computeNote = (version) =>
	`Compute: the ${version.split(" ")[0].toLowerCase()} CLI running the same task an embedded state would, with lua-cjson ${CJSON.version} built from source; timed with os.clock(), which is process CPU time, because standard Lua has no finer wall clock. The embedded and process rows share this measurement.`;

for (const row of ROWS) {
	const result = embedded[row.key].output;
	const computed = compute.entries[row.key];
	writeResult({
		runtime: row.key,
		label: row.label,
		language: "Lua",
		group: "embedded",
		host: `C (lua_bench.c, ${gcc}, static ${row.library})`,
		version: row.version,
		metrics: { memoryBytes: result.memoryBytesPerState, startMs: result.startUs / 1e3, toolCallUs: result.toolCallWallUs, computeMs: computed.medianMs },
		notes: [
			"A state opens only the safe libraries (base, string, table, math, coroutine, utf8) and answers return 1 + 1.",
			`Memory: resident growth across 10,000 live states; the same run's cgroup charge was ${bytes(result.cgroupBytesPerState)} per state.`,
			"Start: median of 2,000 creates after 20 warm-ups.",
			`Tool call: the guest yields each call table from a coroutine and the C host resumes it with a reply table. Median of per-batch means, 1,000,000 calls in batches of 10,000 after 100,000 warm-ups; ${result.toolCallCpuUs} µs of CPU per call.`,
			computeNote(row.version),
		],
		runs: [embedded[row.key], computed],
	});

	const processResult = suite.output.runtimes[row.processKey];
	const processMemory = memory.output.runtimes[row.processKey];
	writeResult({
		runtime: row.processKey,
		label: row.processLabel,
		language: "Lua",
		group: "process",
		host: `Node ${process.version.slice(1)} (spawns the process and talks to it over stdio)`,
		version: row.version,
		metrics: { memoryBytes: processMemory.bytesPerSandbox, startMs: processResult.startMs, toolCallUs: processResult.toolCall.wallUs, computeMs: computed.medianMs },
		notes: [
			`Started as ${row.version.split(" ")[0].toLowerCase()} -e, which prints 1 + 1 and then waits for stdin to close. Not charted: the C host is how Lua is embedded.`,
			`Memory: cgroup charge per added process, median of 3 rounds of 20; USS ${bytes(processResult.memory.ussBytes)}, PSS ${bytes(processResult.memory.pssBytes)}.`,
			"Start: median of 40 spawns until the host reads the first line.",
			`Tool call: guest.lua formats each call and pattern-matches the reply's id. Per-call median over 50,000 calls after 5,000 warm-ups; median of 500-call batches ${processResult.toolCall.batchWallUs} µs; ${processResult.toolCall.cpuUs} µs of CPU per call across host and process.`,
			computeNote(row.version),
		],
		runs: [suite, memory, computed],
	});
}
console.error("[lua] done");
