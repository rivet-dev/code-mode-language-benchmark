#!/usr/bin/env bash
# Runs the sanity re-runs in priority order, logging the 1-minute load before and after each step.
# Outputs go only to this sanity folder.
set -u
S=bench/sanity
B=bench
SU=$B/suite
export INPROC_DIR=$B/inproc
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
	tc node 50000 5000 500 node $SU/guest.mjs
	tc deno 50000 5000 500 deno run --quiet $SU/guest.mjs
	tc bun 50000 5000 500 bun $SU/guest.mjs
	tc python 50000 5000 500 python3 $SU/guest.py
	tc bash 50000 5000 500 bash $SU/guest.sh
	tc dash 50000 5000 500 dash $SU/guest_dash.sh
	tc lua 50000 5000 500 lua $SU/guest.lua
	tc luajit 50000 5000 500 luajit $SU/guest.lua
	tc bun-console-reader 50000 5000 500 bun $S/guest_bun_console.mjs
	tc bun-native-io 50000 5000 500 bun $S/guest_bun_native.mjs
	tc deno-native-io 50000 5000 500 deno run --quiet $S/guest_deno_native.mjs
	tc node-sync-io 50000 5000 500 node $S/guest_node_sync.mjs
"

# 2. CPython fork from a warm parent, in its own memory-accounted scope.
step fork bash -c "systemd-run --user --scope --quiet -p MemoryAccounting=yes python3 $SU/fork_bench.py > $S/fork_rerun.json"

# 3. In-process binding decompositions.
step v8_floor bash -c "node v8_floor.mjs > $S/v8_floor_results.json"
step qjs_floor bash -c "node qjs_floor.mjs > $S/qjs_floor_results.json"
step wasm_compile bash -c "node wasm_compile_check.mjs $B/pyinproc/node_modules/@micropython/micropython-webassembly-pyscript/micropython.wasm $B/inproc/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm > $S/wasm_compile_results.json"

# 4. The same guests served by a lean C host.
TCC=$S/toolcall_c_results.tsv
printf 'guest\tbatch_mean_median_us\thost_cpu_us\tsandbox_cpu_us\n' > "$TCC"
tcc() { local key=$1; shift; printf '%s\t%s\n' "$key" "$(./toolcall_c 50000 5000 500 "$@" | tr ' ' '\t')" >> "$TCC"; }
step toolcalls_c bash -c "
	$(declare -f tcc); TCC=$TCC
	tcc lua lua $SU/guest.lua
	tcc luajit luajit $SU/guest.lua
	tcc python python3 $SU/guest.py
	tcc dash dash $SU/guest_dash.sh
	tcc bash bash $SU/guest.sh
	tcc node node $SU/guest.mjs
	tcc deno deno run --quiet $SU/guest.mjs
	tcc bun bun $SU/guest.mjs
"

# 5. The earlier quiet-host bench (host-driven echo, per-call medians), unchanged.
step bench_mjs bash -c "node $B/bench.mjs $B > $S/bench_mjs_rerun.json"

# 6. Process memory: the original method unpinned, then pinned to one CPU.
step memory_unpinned bash -c "SANDBOXES=20 systemd-run --user --scope --quiet -p MemoryAccounting=yes node $S/memory_cgroup2.mjs $SU > $S/memory_unpinned.json 2> $S/memory_unpinned.log"
step memory_pinned bash -c "SANDBOXES=20 ONLY=dash,lua,luajit,bash,python systemd-run --user --scope --quiet -p MemoryAccounting=yes taskset -c 11 node $S/memory_cgroup2.mjs $SU > $S/memory_pinned.json 2> $S/memory_pinned.log"
echo "ALL DONE load=$(load)" >> "$LOG"
