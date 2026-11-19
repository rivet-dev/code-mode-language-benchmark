// In-process Lua and LuaJIT, measured with the same definitions as the process sandboxes.
//
// start: a new state with the safe libraries, through the result of `return 1 + 1`.
// memory: resident growth per live state after its first response.
// tool call: guest code yields a call table from a coroutine and the host resumes it with a
// reply table, the way an embedder exposes async tools to Lua.
#define _GNU_SOURCE
#include <malloc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "lauxlib.h"
#include "lua.h"
#include "lualib.h"

enum {
	START_RUNS = 2000,
	MEMORY_STATES = 10000,
	WARMUP_CALLS = 100000,
	MEASURED_CALLS = 1000000,
	BATCH = 10000,
};

static const char *GUEST =
	"return function(count)\n"
	"  for id = 1, count do\n"
	"    local reply = coroutine.yield({ id = id, tool = 'lookup', args = { s = 'hello from the sandbox' } })\n"
	"    if reply.id ~= id then error('reply mismatch') end\n"
	"  end\n"
	"end\n";

static double monotonic_ns(void) {
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return now.tv_sec * 1e9 + now.tv_nsec;
}

static double cpu_ns(void) {
	struct timespec now;
	clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &now);
	return now.tv_sec * 1e9 + now.tv_nsec;
}

static long resident_bytes(void) {
	long size = 0;
	long resident = 0;
	FILE *statm = fopen("/proc/self/statm", "r");
	if (statm == NULL) return -1;
	int read = fscanf(statm, "%ld %ld", &size, &resident);
	fclose(statm);
	return read == 2 ? resident * sysconf(_SC_PAGESIZE) : -1;
}

static long cgroup_bytes(void) {
	char line[512];
	char file[640];
	FILE *self = fopen("/proc/self/cgroup", "r");
	if (self == NULL || fgets(line, sizeof line, self) == NULL) {
		if (self) fclose(self);
		return -1;
	}
	fclose(self);
	line[strcspn(line, "\n")] = 0;
	const char *relative = strrchr(line, ':');
	snprintf(file, sizeof file, "/sys/fs/cgroup%s/memory.current", relative ? relative + 1 : "");
	long bytes = -1;
	FILE *current = fopen(file, "r");
	if (current == NULL) return -1;
	if (fscanf(current, "%ld", &bytes) != 1) bytes = -1;
	fclose(current);
	return bytes;
}

static int compare_doubles(const void *left, const void *right) {
	double a = *(const double *)left;
	double b = *(const double *)right;
	return (a > b) - (a < b);
}

static double median(double *values, int count) {
	qsort(values, count, sizeof *values, compare_doubles);
	return values[count / 2];
}

static void fail(const char *what, lua_State *L) {
	fprintf(stderr, "%s: %s\n", what, L ? lua_tostring(L, -1) : "");
	exit(1);
}

static void require_lib(lua_State *L, const char *name, lua_CFunction open) {
#if LUA_VERSION_NUM >= 502
	luaL_requiref(L, name, open, 1);
	lua_pop(L, 1);
#else
	lua_pushcfunction(L, open);
	lua_pushstring(L, name);
	lua_call(L, 1, 0);
#endif
}

/** Opens only the libraries a sandbox keeps: no io, os, package, or debug. */
static void open_safe_libs(lua_State *L) {
	require_lib(L, "_G", luaopen_base);
	require_lib(L, LUA_STRLIBNAME, luaopen_string);
	require_lib(L, LUA_TABLIBNAME, luaopen_table);
	require_lib(L, LUA_MATHLIBNAME, luaopen_math);
#if LUA_VERSION_NUM >= 502
	require_lib(L, LUA_COLIBNAME, luaopen_coroutine);
	require_lib(L, LUA_UTF8LIBNAME, luaopen_utf8);
#endif
}

/** Creates a sandbox state and returns once `return 1 + 1` has answered 2. */
static lua_State *new_sandbox(void) {
	lua_State *L = luaL_newstate();
	if (L == NULL) fail("luaL_newstate", NULL);
	open_safe_libs(L);
	if (luaL_dostring(L, "return 1 + 1") != 0) fail("first response", L);
	if (lua_tointeger(L, -1) != 2) fail("first response was not 2", L);
	lua_pop(L, 1);
	return L;
}

static int resume_guest(lua_State *co, lua_State *from, int nargs) {
#if LUA_VERSION_NUM >= 504
	int nresults = 0;
	return lua_resume(co, from, nargs, &nresults);
#elif LUA_VERSION_NUM >= 502
	return lua_resume(co, from, nargs);
#else
	(void)from;
	return lua_resume(co, nargs);
#endif
}

int main(void) {
	// Memory first, in a fresh heap, so freed states from the start loop cannot be reused.
	lua_State **states = malloc(sizeof *states * MEMORY_STATES);
	malloc_trim(0);
	long before = resident_bytes();
	long charged_before = cgroup_bytes();
	for (int index = 0; index < MEMORY_STATES; index++) states[index] = new_sandbox();
	long after = resident_bytes();
	long charged_after = cgroup_bytes();
	for (int index = 0; index < MEMORY_STATES; index++) lua_close(states[index]);
	free(states);
	malloc_trim(0);

	static double start_samples[START_RUNS];
	for (int run = 0; run < START_RUNS + 20; run++) {
		double started = monotonic_ns();
		lua_State *L = new_sandbox();
		double elapsed = monotonic_ns() - started;
		lua_close(L);
		if (run >= 20) start_samples[run - 20] = elapsed;
	}

	// Tool calls: the guest coroutine yields each call; the host answers and resumes it.
	lua_State *L = new_sandbox();
	if (luaL_dostring(L, GUEST) != 0) fail("guest", L);
	lua_State *co = lua_newthread(L);
	lua_pushvalue(L, -2);
	lua_xmove(L, co, 1);
	lua_pushinteger(co, WARMUP_CALLS + MEASURED_CALLS);

	static double batch_means[MEASURED_CALLS / BATCH];
	int batches = 0;
	long call_index = 0;
	double batch_started = 0;
	double cpu_started = 0;
	int status = resume_guest(co, L, 1);
	while (status == LUA_YIELD) {
		if (call_index == WARMUP_CALLS) {
			cpu_started = cpu_ns();
			batch_started = monotonic_ns();
		} else if (call_index > WARMUP_CALLS && (call_index - WARMUP_CALLS) % BATCH == 0) {
			double now = monotonic_ns();
			batch_means[batches++] = (now - batch_started) / BATCH;
			batch_started = now;
		}

		lua_getfield(co, -1, "id");
		lua_Integer id = lua_tointeger(co, -1);
		lua_pop(co, 1);
		lua_getfield(co, -1, "args");
		lua_getfield(co, -1, "s");
		size_t length = 0;
		lua_tolstring(co, -1, &length);
		lua_settop(co, 0);

		lua_createtable(co, 0, 3);
		lua_pushinteger(co, id);
		lua_setfield(co, -2, "id");
		lua_pushboolean(co, 1);
		lua_setfield(co, -2, "ok");
		lua_pushinteger(co, (lua_Integer)length);
		lua_setfield(co, -2, "value");

		call_index++;
		status = resume_guest(co, L, 1);
	}
	if (status != 0) fail("guest failed", co);
	double cpu_total = cpu_ns() - cpu_started;
	batch_means[batches++] = (monotonic_ns() - batch_started) / BATCH;
	if (call_index != WARMUP_CALLS + MEASURED_CALLS) fail("guest stopped early", NULL);
	lua_close(L);

	printf("{\"luaVersionNum\":%d,\"startUs\":%.3f,\"memoryBytesPerState\":%.0f,\"toolCallWallUs\":%.4f,\"toolCallCpuUs\":%.4f,\"cgroupBytesPerState\":%.0f}\n",
		LUA_VERSION_NUM,
		median(start_samples, START_RUNS) / 1e3,
		(double)(after - before) / MEMORY_STATES,
		median(batch_means, batches) / 1e3,
		cpu_total / MEASURED_CALLS / 1e3,
		charged_before < 0 ? -1.0 : (double)(charged_after - charged_before) / MEMORY_STATES);
	return 0;
}
