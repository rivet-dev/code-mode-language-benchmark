#!/usr/bin/env bash
# Runs the sanity re-runs in priority order, logging the 1-minute load before and after each step.
# These cross-check the methods in benches/; they are not part of npm run bench. Outputs go only
# to this folder. Needs npm install at the repository root.
set -u
S=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$S/../../.." && pwd)
B=$ROOT/benches
export INPROC_DIR=$ROOT
cd "$S" || exit 1
LOG=$S/run_all.log
: > "$LOG"
load() { cut -d' ' -f1 /proc/loadavg; }
step() {
	local name=$1
	shift
	echo "== $name start load=$(load) at $(date +%T)" >> "$LOG"
	"$@"
	echo "== $name end load=$(load) at $(date +%T) exit=$?" >> "$LOG"
}

# 1. Process tool calls with the suite's exact protocol and statistic, plus per-call medians.
TC=$S/toolcall_results.jsonl
: > "$TC"
tc() { node toolcall_host.mjs "$@" >> "$TC"; }
step toolcalls bash -c "
	$(declare -f tc); TC=$TC
	tc node 50000 5000 500 node $B/javascript/guest.mjs
	tc deno 50000 5000 500 deno run --quiet $B/javascript/guest.mjs
	tc bun 50000 5000 500 bun $B/javascript/guest.mjs
	tc python 50000 5000 500 python3 $B/python/guest.py
	tc bash 50000 5000 500 bash $B/shell/guest.sh
	tc dash 50000 5000 500 dash $B/shell/guest_dash.sh
	tc lua 50000 5000 500 lua $B/lua/guest.lua
	tc luajit 50000 5000 500 luajit $B/lua/guest.lua
	tc bun-console-reader 50000 5000 500 bun $S/guest_bun_console.mjs
	tc bun-native-io 50000 5000 500 bun $S/guest_bun_native.mjs
	tc deno-native-io 50000 5000 500 deno run --quiet $S/guest_deno_native.mjs
	tc node-sync-io 50000 5000 500 node $S/guest_node_sync.mjs
"

# 2. CPython fork from a warm parent, in its own memory-accounted scope.
step fork bash -c "systemd-run --user --scope --quiet -p MemoryAccounting=yes python3 $B/python/fork_bench.py > $S/fork_rerun.json"

# 3. In-process binding decompositions.
step v8_floor bash -c "node v8_floor.mjs > $S/v8_floor_results.json"
step qjs_floor bash -c "node qjs_floor.mjs > $S/qjs_floor_results.json"
step wasm_compile bash -c "node wasm_compile_check.mjs $ROOT/node_modules/@micropython/micropython-webassembly-pyscript/micropython.wasm $ROOT/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm > $S/wasm_compile_results.json"

# 4. The same guests served by a lean C host.
[ -x toolcall_c ] || gcc -O2 -o toolcall_c toolcall_c.c
TCC=$S/toolcall_c_results.tsv
printf 'guest\tbatch_mean_median_us\thost_cpu_us\tsandbox_cpu_us\n' > "$TCC"
tcc() { local key=$1; shift; printf '%s\t%s\n' "$key" "$(./toolcall_c 50000 5000 500 "$@" | tr ' ' '\t')" >> "$TCC"; }
step toolcalls_c bash -c "
	$(declare -f tcc); TCC=$TCC
	tcc lua lua $B/lua/guest.lua
	tcc luajit luajit $B/lua/guest.lua
	tcc python python3 $B/python/guest.py
	tcc dash dash $B/shell/guest_dash.sh
	tcc bash bash $B/shell/guest.sh
	tcc node node $B/javascript/guest.mjs
	tcc deno deno run --quiet $B/javascript/guest.mjs
	tcc bun bun $B/javascript/guest.mjs
"

# 5. The earlier quiet-host bench (host-driven echo, per-call medians), unchanged.
step bench_mjs bash -c "node $S/bench.mjs $B/javascript > $S/bench_mjs_rerun.json"

# 6. Process memory: the original method unpinned, then pinned to one CPU.
step memory_unpinned bash -c "SANDBOXES=20 systemd-run --user --scope --quiet -p MemoryAccounting=yes node $S/memory_cgroup2.mjs $B/javascript > $S/memory_unpinned.json 2> $S/memory_unpinned.log"
step memory_pinned bash -c "SANDBOXES=20 ONLY=dash,lua,luajit,bash,python systemd-run --user --scope --quiet -p MemoryAccounting=yes taskset -c 11 node $S/memory_cgroup2.mjs $B/javascript > $S/memory_pinned.json 2> $S/memory_pinned.log"
echo "ALL DONE load=$(load)" >> "$LOG"
