# Agent scripting runtimes: measurement methodology, pitfalls, prior benchmark data, and case studies

Compiled 2026-11-13. Tags used throughout: **[STALE]** means the data or source predates 2024-01-01; **[VENDOR]** means a vendor or project making a claim about its own product, not independently verified; **(computed)** means a number I derived from published raw data; **(internal)** means data from the user's own `secure-exec` repository on this machine. Section order follows the assignment: one-page methodology summary and pitfalls, then the benchmark-data digest, then case studies. The detailed methodology for each key question (memory, CPU, load, HTTP) follows as reference sections 4 to 7.

## 1. One-page methodology summary and pitfalls list

### Takeaway
Measure marginal cost as the **slope** of a cgroup-v2 metric (`memory.current` with its `memory.stat` breakdown, and `cpu.stat usage_usec`) against the number of live sessions or completed scripts. Run each experiment in a fresh, dedicated cgroup and measure at explicitly defined lifecycle states (idle, suspended on host calls, peak, post-GC). Use PSS and USS from `smaps_rollup` to attribute shared copy-on-write pages. Drive load open-loop, record latency from the intended start time in HdrHistogram, and use a local, controllable HTTP server with injected latency instead of public endpoints.

### Cited Findings
- `/proc/PID/smaps_rollup` reports totals of the smaps fields across all mappings and adds `Pss_Anon`, `Pss_File`, `Pss_Shmem`. PSS divides each page by the number of processes sharing it. — [Linux proc docs](https://docs.kernel.org/filesystems/proc.html)
- `/proc/PID/status` RSS values are "handled in an asynchronous manner and the value may not be very precise", while smaps is "slow but very precise". — [Linux proc docs](https://docs.kernel.org/filesystems/proc.html)
- cgroup v2 `memory.current` is total usage of the cgroup and its descendants. Writing to `memory.peak` resets it to current usage for later reads through the same file descriptor. `memory.stat` splits `anon`, `file`, `kernel`, `pagetables`, `sock`, `shmem`, and other fields. `cpu.stat` always reports `usage_usec`, `user_usec`, and `system_usec`. — [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- The memory controller "assigns page ownership on the first use and doesn't update it until the page is released", so page cache is charged to whichever cgroup touched it first. — [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- In a closed loop each connection sends only after receiving a response, so slow periods go unmeasured (coordinated omission). wrk2 measures latency from the time a request "should have occurred". In wrk2's example with a 1.4 s pause, the uncorrected p99 was 6.04 ms and the corrected p99 was 1.27 s. — [wrk2 README](https://github.com/giltene/wrk2)
- Only 30.0–43.5% of ⟨VM, benchmark⟩ pairs consistently reached a steady state of peak performance across 30 process executions, so steady-state assumptions are often wrong. — [Barrett et al., OOPSLA 2017 (arXiv)](https://arxiv.org/abs/1602.00602v6); summary in [search of paper versions](https://arxiv.org/pdf/1602.00602)
- Rigorous benchmarking needs repetition at several levels (iterations, process invocations, builds), sized by where the variance arises, and results reported as effect-size confidence intervals. — [Kalibera & Jones, ISMM 2013](https://bibtex.github.io/ISMM-2013-KaliberaJ.html)

### Inferences
**Concrete methodology (Linux; details and sources in sections 4 to 7):**

*A. Rig*
1. Use a dedicated Linux host (bare metal, or a VM that exposes PMU counters). Record CPU model, kernel (`uname -r`), THP mode (`/sys/kernel/mm/transparent_hugepage/enabled`), KSM (`/sys/kernel/mm/ksm/run`), swap state, governor, and all runtime and library versions and build flags. Build flags include V8 pointer compression, jitless, and sandbox; the Wasmtime `Config`; and the allocator.
2. Reduce noise: use the `performance` governor, disable turbo/boost and SMT (or pin to one hyperthread per core), and partition cores among the system under test (SUT), the load generator, and the HTTP server. `pyperf system tune` and the LLVM benchmarking guide automate or list these steps.
3. Run every experiment in its own transient cgroup, for example `systemd-run --user --scope -p MemoryAccounting=yes -p CPUAccounting=yes -p AllowedCPUs=2-9 -p MemorySwapMax=0 --unit=bench-$RUN -- ./harness …`. Run the load generator and HTTP server in sibling cgroups. Read `memory.current`, `memory.peak`, `memory.stat`, and `cpu.stat` under `/sys/fs/cgroup/<unit path>/`.
4. Implement one "session driver" per runtime with the same contract: `create()`, `run(script)` with host tool functions bound, await of host calls, and `destroy()`. Port the same guest scripts to each language with identical algorithms written idiomatically, following the Are We Fast Yet rule.

*B. Memory (marginal = slope)*
5. Define the lifecycle states:
   - **S0:** engine loaded, no session (fixed cost).
   - **S1:** session created and idle.
   - **S2:** after a reference code-mode script (for example 10 tool calls returning 1 KB JSON each, then aggregation).
   - **S3:** suspended mid-script with k ∈ {1, 10, 100} pending host calls.
   - **S4:** retained after run, after GC.
   - **Peak:** during S2.
6. For N ∈ {0, 1, 10, 100, 1 000, 10 000} sessions held live in state S, quiesce, then sample:
   - cgroup `memory.current`;
   - `memory.stat` fields `anon`, `file`, `kernel`, `pagetables`, `kernel_stack`, `sock`, `shmem`;
   - `smaps_rollup` fields `Rss`, `Pss`, `Pss_Anon`, `Pss_File`, and USS = `Private_Clean` + `Private_Dirty`;
   - `VmSize`;
   - the runtime-reported heap.

   To quiesce, run the runtime GC, then purge the allocator (`malloc_trim(0)`, jemalloc `arena.<all>.purge`, `mi_collect(true)`), then wait longer than the allocator decay time. Also take an "as-is" sample without forcing GC, because that is what production sees.
7. Fit metric(N) = a + b·N (OLS plus Theil–Sen) over ≥5 fresh-process repetitions. Report the slope b (bytes per session) with a bootstrap 95% CI, the intercept a, and residuals; residuals expose step functions such as arena growth, pool slabs, and page tables. The OS slope minus the runtime-heap slope gives the native, allocator, and binding overhead.
8. Peak per script:
   - **Process-per-session:** give each session its own cgroup and read `memory.peak` (reset it through the same fd).
   - **In-process:** run scripts serially, and combine runtime peak counters with the process `memory.peak` delta.
9. Report USS (what killing one session frees) and PSS (fair share) separately for anything built on snapshots, CoW images, or fork zygotes. Re-check after S2, because writes break sharing.
10. Report virtual reservations separately: `VmSize`, mapping count (`wc -l /proc/PID/maps`), and the `pagetables` slope. Check `RLIMIT_AS` (`prlimit`), `vm.max_map_count`, and overcommit.

*C. CPU*
11. The primary metric is the Δ`cpu.stat usage_usec` (user/system split) of the SUT cgroup per completed script at a fixed arrival rate. Attribute it by thread name with per-thread `/proc/PID/task/TID/schedstat` (ns on-CPU), splitting guest thread vs host event loop vs GC/JIT/compile helper threads.
12. For microbenchmarks use `perf stat -e task-clock,cycles,instructions,context-switches,cpu-migrations,page-faults -r 30`, criterion for in-process Rust, and hyperfine for CLI cold start. Prefer instructions retired for A/B comparisons.
13. Host-call cost: have the guest call a no-op host function n times and fit time(n) = c + n·t_call. Repeat at 0 B, 1 KB, and 1 MB payloads, and for each encoding: JSON text, V8 structured clone, CBOR, MessagePack, direct handles or userdata, and ArrayBuffer transfer. Subtract a guest-local-call baseline.
14. Report cold (new process), warm-engine (new session in a warm process), and hot (reused session) separately. For JIT runtimes, report iteration 1, iterations 2–10, and steady state over ≥30 process executions × ≥10 iterations.
15. Statistics: medians with bootstrap CIs; Mann–Whitney U for A/B (as Sightglass does); always report absolute values; never compare across different machines.

*D. Load*
16. Use an open-loop generator with a precomputed constant or Poisson arrival schedule, latency measured from the intended start, and HdrHistogram for p50/p99/p99.9/max plus errors. Use a closed loop only for "max throughput", and label it.
17. Run concurrency and rate sweeps from 10% to 120% of saturation, recording CPU per script, memory versus in-flight sessions, and latency percentiles.
18. For a fixed CPU budget, set `cpu.max` to `"200000 100000"` (2 CPUs) plus a cpuset. Find the maximum rate with p99 under the SLO, and report scripts/s per core and memory per in-flight session (in-flight = λ × latency, by Little's law).
19. Tool-call scaling: run k ∈ {0, 1, 10, 100, 1 000} host calls per script, serial and parallel (`Promise.all`, `asyncio.gather`, coroutines), with host delay D ∈ {0, 1 ms, 50 ms, 1 s}. Fit CPU(k) and peak-memory(k) slopes. Expect serial latency ≈ k·(D+o) and parallel latency ≈ D + k·o.
20. Suspended sessions: hold N sessions awaiting host calls that resolve after 10–60 s. Measure the memory slope and the idle CPU, which should be ≈0. Use schedstat or `perf stat` over the idle window to catch timers and polls.

*E. Real HTTP*
21. Run a local HTTP server (hyper/axum or go-httpbin) on separate cores and in its own cgroup. Control delay, size, chunking, status, TLS (rustls with a local CA), keep-alive, and HTTP/1.1 vs h2 through query parameters.
22. Inject RTT with `tc netem` on a veth pair between network namespaces, or with Toxiproxy, and verify it with ping or curl timing.
23. Compare the host-provided fetch tool (a shared pool in the host's HTTP stack) against the runtime-embedded client. Measure CPU per request, memory per in-flight request (slope while the server holds responses), established connections (`ss -Htn state established | wc -l`), TLS handshakes (a server-side counter), and `memory.stat sock`.

*F. Report:* for each runtime × state × workload, report the fixed cost a, the marginal b (± CI), the peak, CPU per script, p50/p99, the maximum rate under the budget, the isolation level, and which limits were enabled. Publish the raw JSON and the full configuration.

**Pitfalls (one line each; sources in sections 4–7):**
1. Using `VmRSS`/RSS as the marginal cost. It double-counts shared file pages (binaries, snapshots) per process and is imprecise. Use cgroup anon+kernel, PSS, and USS.
2. Measuring one instance. Allocator chunk and page granularity swamp small runtimes such as Lua states, so fit a slope over large N.
3. Measuring right after create. Lazy allocation and first-touch faults understate real sessions, so measure after a realistic script.
4. Allocator retention counted as runtime cost. This covers glibc arenas, jemalloc decay, and mimalloc purge delay (1 000 ms default in v3). Report trimmed and untrimmed values.
5. Page cache charged on first touch. Pyodide's stdlib, Wasm modules, and V8 snapshots read from disk land in `file` of whichever cgroup read them first. Use fresh cgroups and report `file` separately.
6. Treating virtual reservations as harmless. Examples are Wasmtime's 4 GiB reservation plus 32 MiB guard per memory, about 4 GiB per pooling slot, and the V8 sandbox's 1 TB. They are not RSS, but they hit `RLIMIT_AS` (for example Windmill's nsjail default of 4096 MiB for Python), map counts, and page tables.
7. Forgetting that Wasm linear memory can grow but not shrink. Peak becomes steady state for Pyodide and QuickJS-in-Wasm.
8. GC timing. Heaps grow before collecting, so compare forced-GC and natural values.
9. Using `RUSAGE_THREAD` or the guest thread alone. It misses V8 GC/compiler threads and host I/O threads, and CPU time can exceed wall time.
10. Assuming a JIT steady state. Code-mode scripts are short and run once, so first-iteration cost and interpreter tiers matter.
11. Frequency scaling, turbo, SMT, and environment-size bias. Pin cores, fix the frequency, and vary the environment size as the Benchmarks Game does.
12. Closed-loop load generators, which cause coordinated omission. Averaging percentiles is a related mistake; merge histograms instead.
13. Public HTTP endpoints, which add noise, rate limits, and CDN variance. Use a local server with injected latency.
14. Comparing results across machines and OSes, such as macOS M5 Max vs EPYC Linux vs a Ryzen at a fixed 2 GHz.
15. Version drift. QuickJS's 2026-06-04 release claims +42% on bench-v8, and Wasmtime went from 2.67× to 2.41× native in two years. Pin and record versions.
16. Benchmarking without production limits. Fuel or instruction counting, interrupt hooks, and memory-limit callbacks cost CPU, so enable them.
17. Trusting soft limits. isolated-vm's `memoryLimit` can be exceeded 2–3×, and Luau imposes no memory limit by default, so test the enforcement path itself.
18. Ignoring serialization. Copying dominates large payloads, so measure the per-byte slope and the zero-copy paths separately.
19. Async semantics differ. A runtime without async needs a thread per suspended session, with a stack (2 MiB default in Rust std) and a kernel stack. Snapshot-and-resume designs avoid holding interpreter state.
20. Benchmarking crimes: cherry-picked subsets, no CIs, relative-only numbers, and missing baselines. Tier-1 papers averaged five such flaws.
21. Polling `smaps` at high frequency. It is slow and racy and perturbs the system under test, so sample at quiescent points.
22. `memory.peak` reset semantics are per file descriptor, and a 2026 patch reports a reset clobbering other fds' watermarks. Use one fd per measurement or separate cgroups.
23. Uncontrolled KSM, THP, and swap or zswap settings change memory results, so fix and record them.
24. Comparing efficiency across unequal isolation levels without saying so. `node:vm` is not a security mechanism, and vm2 and Pyodide-in-Node sandboxes were escaped. Label insecure baselines.

### Gaps
- No single public harness already measures marginal memory per session across V8 isolates, QuickJS, Lua/Luau, Pyodide, CPython/WASI, Wasm runtimes, Rhai, and Rune under concurrent async load. We have to build it; existing suites cover CPU throughput of compute kernels, startup, or one host language.
- I could not confirm which kernel release first shipped the writable, per-fd `memory.peak`. The 2024 patch series is by David Finkel ([patchwork](https://patchwork.kernel.org/comment/25947675)); test for support at runtime.

## 2. Benchmark-data digest: existing suites and published numbers

### Takeaway
Current cross-runtime data covers **CPU on compute kernels and startup**, not marginal memory per sandbox under async load. The freshest reusable data:
- Rust-embedded scripting with host interop: **script-bench-rs**, Oct 2026. Luau 11.8 ms, Lua 5.5 15.5 ms, rquickjs 36.4 ms, Boa 80 ms, Rhai 112 ms.
- JS engines: **javascript-zoo**, data Mar 2026. V8 with JIT is about 18× V8 `--jitless`, which is about 2.5× QuickJS, which is about 4.8× Boa (computed).
- Wasm runtimes: **Frank Denis**, Jun 2026. Wasmtime 2.41× native, WAMR AOT 1.57×, Node 7.95×.
- Process baseline: **hanabi1224 helloworld**, Aug 2025. Node 50.7 MB and 32 ms, CPython 8.8 MB and 13 ms, Lua 2.1 MB and 1.4 ms, Wasmtime 18 MB and 6.4 ms.

Density claims, such as Cloudflare's "a few MB per isolate", Firecracker's "<5 MiB", and Monty's "~5 MB, µs startup", are vendor claims.

### Cited Findings

#### 2.1 khvzak/script-bench-rs: Rust-hosted scripting with heavy host interop (results refreshed 2026-10-03)
- Purpose: "benchmark most popular embedded scripting languages for Rust… cover not only the performance of code evaluation but interoperability with Rust too". Current set: boa v0.22.0, koto v0.16.1, mlua v0.12.2 (Lua 5.5 and Luau), rhai v1.26.1, roto v0.12.0, rquickjs v0.14.0, wasmi v2.0.0, wasmtime v49.0.2. Environment: macOS 27.0, Apple M5 Max, rustc 1.99.0. Timings use `cargo criterion`, and the plot shows the "typical" estimate. — [script-bench-rs README](https://github.com/khvzak/script-bench-rs); [bench.py](https://raw.githubusercontent.com/khvzak/script-bench-rs/main/bench.py)
- Workload (Lua version): build 10,000 `RustData` host objects from random strings generated through a host `rand` function, then quicksort them with `<` comparisons on host-owned userdata. — [sort_userdata.lua](https://raw.githubusercontent.com/khvzak/script-bench-rs/main/scripts/sort_userdata.lua)
- Results ("Sort Rust objects", ms, lower is better). Ratios are computed. — [results image](https://github.com/khvzak/script-bench-rs/blob/main/Sort%20Rust%20objects.png)

| Runtime | ms | vs Luau |
|---|---|---|
| wasmtime (guest is Rust compiled to wasm32, not a script language) | 2.71 | 0.23× |
| wasmi (same Rust→Wasm guest, interpreter) | 7.04 | 0.60× |
| mlua Luau | 11.82 | 1.00× |
| roto | 12.04 | 1.02× |
| mlua Lua 5.5 | 15.47 | 1.31× |
| rquickjs (QuickJS) | 36.38 | 3.08× |
| koto | 49.33 | 4.17× |
| boa | 79.99 | 6.77× |
| rhai | 112.02 | 9.48× |

- Rune and LuaJIT are not in the current runtime set. — [script-bench-rs README](https://github.com/khvzak/script-bench-rs)

#### 2.2 ivankra/javascript-zoo: many JS engines on the V8 v7 and Octane-style suite (engine revisions 2024-01 to 2026-03; repo last commit 2026-05-26)
- The repo benchmarks "different engines on V8's test suite" and publishes machine-readable results at zoo.js.org/engines.json. — [javascript-zoo README](https://github.com/ivankra/javascript-zoo)
- Scores below are higher-is-better per-benchmark scores from `engines.json` on amd64. The geomean over the 8 classic V8-v7 benchmarks (Richards, DeltaBlue, Crypto, RayTrace, EarleyBoyer, RegExp, Splay, NavierStokes) is **computed** by me. `engines.json` does not state the hardware. — [engines.json](https://zoo.js.org/engines.json)

| Engine (revision date) | Geomean (computed) | Richards | DeltaBlue | Binary size |
|---|---|---|---|---|
| V8 14.7 with JIT (2026-03-02) | 47,285 | 37,102 | 106,675 | 21.9 MB |
| JavaScriptCore (2026-03-03) | 45,365 | 41,148 | 58,977 | 30.1 MB |
| SpiderMonkey 148 (2026-03-02) | 19,781 | 14,025 | 13,640 | 17.2 MB |
| GraalJS 25.0.2 | 11,531 | 37,074 | 24,517 | n/a |
| V8 `--jitless` | 2,614 | 1,460 | 1,668 | 13.3 MB |
| JSC jitless | 1,642 | 1,247 | 969 | 14.3 MB |
| Hermes (2026-03-02) | 1,494 | 1,132 | 1,051 | 4.7 MB |
| Escargot (2026-02-12) | 1,314 | 1,214 | 1,340 | 5.4 MB |
| QuickJS (2025-12-22) | 1,046 | 787 | 722 | 1.1 MB |
| QuickJS-ng 0.12.1 (2026-03-02) | 938 | 741 | 735 | 1.2 MB |
| LibJS | 730 | 591 | 539 | 47.3 MB |
| Duktape (2024-01-29) | 637 | 381 | 441 | 0.7 MB |
| XS 17.9.1 | 374 | 252 | 381 | 2.2 MB |
| Brimstone | 275 | 122 | 184 | 6.5 MB |
| Boa (2026-03-03) | 216 | 170 | 146 | 31.9 MB |
| Kiesel | 214 | 144 | 140 | 14.3 MB |

- QuickJS's newest release (2026-06-04, after the zoo data) claims to be "42% faster than the previous release based on the bench-v8 (aka v8-v7) score". The same page claims "367 KiB of x86 code for a simple hello world program" and a runtime life cycle under 300 µs. **[VENDOR]** — [QuickJS homepage](https://bellard.org/quickjs/)

#### 2.3 attractivechaos/plb2: interpreter vs JIT on compute kernels (runtime versions from early 2024; Apple M1; wall-clock seconds; hyperfine)
- Benchmarks: nqueen (15 queens), matmul (1500×1500), sudoku (4000 puzzles), bedcov (interval overlap on 1M intervals). — [plb2 README](https://github.com/attractivechaos/plb2)

| Implementation | nqueen | matmul | sudoku | bedcov |
|---|---|---|---|---|
| C clang (reference) | 2.57 | 0.54 | 1.56 | 0.84 |
| Node 21.5.0 JIT | 3.73 | 2.88 | 3.77 | 2.45 |
| Node, no JIT | 55.48 | 162.84 | 63.91 | 20.81 |
| Bun 1.0.20 | 3.11 | 1.75 | 3.07 | 2.32 |
| Deno 1.39.1 | 4.00 | 3.06 | 4.04 | 2.50 |
| QuickJS | 59.04 | 135.66 | 67.55 | 37.56 |
| LuaJIT 2.1 | 5.31 | 2.66 | 4.48 | 10.52 |
| CPython 3.11.7 | 159.97 | 117.81 | 52.88 | 42.84 |
| PyPy 7.3.14 | 6.91 | 4.89 | 8.82 | 6.27 |

- Source for the table above: [plb2 README](https://github.com/attractivechaos/plb2). The fetched table showed no plain (non-JIT) Lua row.
- Author notes: "runtimes may use extra threads for tasks such as garbage collection, so CPU time may exceed elapsed time"; JIT warm-up takes up to about 0.3 s; and plb2 "does not evaluate memory allocation or garbage collection". — [plb2 README](https://github.com/attractivechaos/plb2)

#### 2.4 hanabi1224 programming-language-benchmarks: helloworld process baseline (generated 2025-08-01; AMD EPYC 7763, 4 cores)

| Runtime | Time | Peak mem | user/sys |
|---|---|---|---|
| node 24.4.1 | 32 ms | 50.7 MB | 18/4 ms |
| deno 2.4.3 | 26 ms | 45.5 MB | 10/8 ms |
| bun 1.2.19 | 11 ms | 30.6 MB | 0/0 |
| lua 5.4.7 | 1.4 ms | 2.1 MB | 0/0 |
| luajit 2.1.0-beta3 | 1.4 ms | 2.4 MB | 0/0 |
| cpython 3.13.5 | 13 ms | 8.8 MB | 0/0 |
| pypy 3.11.13 | 29 ms | 52.2 MB | 10/10 ms |
| wasmtime 35.0.0 (wasm guest) | 6.4 ms | 18.0 MB | 0/0 |
| rust 1.88.0 | 1.2 ms | 1.8 MB | 0/0 |
| go 1.24.5 | 1.5 ms | 3.4 MB | 0/0 |
| C gcc 15.1.0 | 1.2 ms | 2.1 MB | 0/0 |

- Source for the table: [helloworld results](https://programming-language-benchmarks.vercel.app/problem/helloworld). The page does not describe how memory is measured, and it notes "time < time(user) + time(sys)… the overhead is from GC or JIT compiler". It has no QuickJS entry.

#### 2.5 bdrung/startup-time: process startup [STALE 2018-02-10]
- On an Intel i5-2400S running Ubuntu 17.10: C 0.26 ms, Go 0.41 ms, Rust 0.51 ms, Lua 5.2.4 0.63 ms, Bash 0.71 ms, Perl 0.94 ms, Python 3.6 25.84 ms (9.31 ms with `-S`), Ruby 2.3 32.43 ms. Node.js and LuaJIT are absent. Method: 1000 runs through a tiny `run.c`, pinned with `taskset -c 0`. — [startup-time README](https://github.com/bdrung/startup-time)

#### 2.6 Are We Fast Yet (Marr et al.) [published results STALE 2016-06-20]
- 14 benchmarks (macro: CD, DeltaBlue, Havlak, Json, Richards; micro: Bounce, List, Mandelbrot, NBody, Permute, Queens, Sieve, Storage, Towers) "ported to ten different languages", including JavaScript, Lua, Python, Ruby, and C++. Rules: implementations are "identical" across languages using a common core subset, written idiomatically. — [AWFY README](https://github.com/smarr/are-we-fast-yet)
- The only results in the repo are peak performance normalized to Java 1.8.0_91 (2016-06-20), as geomean slowdown: Graal.js 2.23×, Node.js 2.89×, JRuby 12.83×, MRI 45.62×. Lua, LuaJIT, CPython, and PyPy have no published numbers there. — [AWFY performance.md](https://github.com/smarr/are-we-fast-yet/blob/master/docs/performance.md)

#### 2.7 Computer Language Benchmarks Game: methodology to copy
- Uses BenchExec, which "uses the cgroups feature of the Linux kernel to correctly handle groups of processes". The host is unloaded and off the network, caches and swap are cleared, and the first run is excluded. The UNIX environment size is varied "to reduce measurement bias". Each program gets 12 measurements; the site reports the lowest elapsed time and a 95% t-score CI over 11 CPU-time measurements. Hardware: quad-core i5-3330, Ubuntu 24.04, Linux 6.8. — [How programs are measured](https://benchmarksgame-team.pages.debian.net/benchmarksgame/how-programs-are-measured.html)

#### 2.8 Frank Denis: Wasm runtimes on libsodium (published 2026-06-23)
- Geomean slowdown vs native (lower is better):
  - Wasmtime: 2.67 (v22, 2024), 2.54 (v34, 2025), 2.41 (v46, 2026).
  - Node: 8.60 (22.3.0), 7.95 (26.3.1).
  - Bun 1.3.14: 8.77.
  - Wazero: 4.84, 4.70, 4.72.
  - WAMR AOT: 1.59 (2.3.1), 1.57 (2.4.4).
  - WasmEdge AOT: 1.74.
  - Wasmer 7.1.0: 2.08, or 1.33 with `wide_arithmetic`; Wasmtime with `wide_arithmetic`: 1.46.
  - WAVM had the fastest 2026 baseline.

  Hardware: Ryzen AI 9 HX 470 with boost disabled and a 2 GHz maximum. Method: `-Diterations=3` ("tiny tests are noisy and quantized"), no CPU pinning described. — [00f.net 2026](https://00f.net/2026/06/23/webassembly-runtimes-2026/)
- Earlier editions (2019, 2021, 2023) exist. A July 2026 companion post covers Wasm-to-C translation. — [2023 edition](https://00f.net/2023/01/04/webassembly-benchmark-2023/); [2026 wasm2c post](https://00f.net/2026/07/08/webassembly-compilation-to-c-2026/)

#### 2.9 Sightglass (Bytecode Alliance): Wasm benchmark methodology
- Results "are always broken down by phase — compilation vs. instantiation vs. execution". Measures: `cycles` (default), `insts-retired`, `perf-counters`, and `callgrind` ("mostly deterministic and very low noise"). Statistics use the Mann–Whitney U test, "because benchmark results are not normally distributed", and report effect sizes only for significant results. — [Sightglass README](https://github.com/bytecodealliance/sightglass)

#### 2.10 Python in Wasm (Pyodide) and Python subsets: startup data
- Pydantic's startup table: Monty 0.004 ms, Docker 195 ms, "sandbox services" ~1000 ms+, Pyodide 2800 ms. **[VENDOR]** (Pydantic promoting Monty, 2026-02-27) — [Pydantic Monty article](https://pydantic.dev/articles/pydantic-monty)
- Cloudflare Python Workers, which use Pyodide plus deploy-time memory snapshots, report a mean cold start of 1027 ms, against AWS Lambda at 2502 ms and Cloud Run at 3069 ms, with httpx, fastapi, and pydantic loaded. The same benchmark takes "around 10 seconds" without a snapshot. **[VENDOR]** (2025-12-08) — [Cloudflare changelog](https://developers.cloudflare.com/changelog/2025-12-08-python-cold-start-improvements); [How Python Workers work](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)
- An older Pyodide roadmap gives a 6.4 MB first download and 4–5 s environment initialization **[STALE / undated]**. — [Pyodide roadmap (mirror)](https://pyodide-ryanking13.readthedocs.io/en/latest/project/roadmap.html)

#### 2.11 Isolate, sandbox, and VM density claims
- Cloudflare Dynamic Workers (2026-03-24): an isolate takes "a few milliseconds to start" and "a few megabytes of memory". The post puts containers at "hundreds of milliseconds to boot and hundreds of megabytes", and claims isolates are "around 100x faster and 10x-100x more memory efficient than a typical container". **[VENDOR]** — [Cloudflare blog](https://blog.cloudflare.com/dynamic-workers)
- Firecracker: "Boot in <125ms", "<5 MiB overhead per VM", "up to 150 microVMs per second per host" (VMM overhead only, undated, no test conditions). **[VENDOR]** — [Firecracker site](https://firecracker-microvm.github.io/)
- Netlify's Unikraft-managed microVMs: "under 1ms" creation, about 2 ms start at p99, cold invocations about 1.2% of the total averaging about 9 ms. **[VENDOR]** (late 2026) — [Netlify blog](https://www.netlify.com/blog/edge-functions-firecracker-microvms/)
- E2B cold start measured by ComputeSDK as of 2026-03-18: p50 440 ms, p95 950 ms, p99 3150 ms. This is secondhand, from the Secure Exec website component (internal) citing [ComputeSDK benchmarks](https://www.computesdk.com/benchmarks/); local file `secure-exec/website/src/components/Benchmarks.tsx`.
- An earlier public Secure Exec benchmark using isolated-vm reported "per-runtime RSS converging to ≤3.1 MB at scale" with JS heap delta ~0, calling RSS an upper bound. (internal / [VENDOR], seen via a mirror in search results) — [search result mirror of secureexec.dev/docs/benchmarks](https://siteproxy-6gq.pages.dev/default/https/secureexec.dev/docs/benchmarks)
- Current Secure Exec repo docs (run 2026-06-19, i7-12700KF, 5 iterations + 1 warmup): owned-sidecar cold mean 772.88 ms and warm 452.68 ms; resident-runner warm 1.27 ms. The phases are dominated by `runtime_mount_wasm` (172.95 ms p50) and `first_exec` (596.26 ms). A shared sidecar degrades to >3 s under concurrent fan-out. (internal) — local file `secure-exec/website/src/content/docs/docs/benchmarks.mdx`
- Platformatic says enabling V8 pointer compression in Node.js (the `node-caged` images) gives ~50% memory reduction "for pointer-heavy workloads". The Node.js integration landed in October 2025; isolate groups were built by Igalia with Cloudflare sponsorship. **[VENDOR]** — [Platformatic blog](https://blog.platformatic.dev/we-cut-nodejs-memory-in-half); [Igalia news](https://www.igalia.com/2025/10/03/Helping-Cloudflare-To-Improve-Code-Security.html)
- Monty: "about 5MB" memory overhead when used from CPython, a "~4.5MB" package, snapshots of "single-digit kilobytes", and 4.5 µs hello-world execution without type checking (4.8 ms with it). **[VENDOR]** (2026-02-27) — [Pydantic Monty article](https://pydantic.dev/articles/pydantic-monty). Starting a new session takes "0.8 ms from a warm pool", compared with "About 1.5 s for a new Daytona sandbox, in one measurement". **[VENDOR]** (2026-11-10) — [Code mode is not a sandbox](https://pydantic.dev/articles/code-mode-vs-sandboxes)

#### 2.12 Code-mode outcome numbers (context, not runtime cost)
- Anthropic's "Code execution with MCP" (2025-11-04) example goes from ~150,000 tokens to ~2,000 (98.7%). It is one representative workflow, not a general benchmark. — [Anthropic engineering](https://www.anthropic.com/engineering/code-execution-with-mcp)
- Cloudflare says converting an MCP server to a TypeScript API can "cut token usage by 81%". **[VENDOR]** — [Cloudflare blog](https://blog.cloudflare.com/dynamic-workers)
- Pydantic's weather agent (claude-sonnet-4-5): tool calling took 12.2 s with 4 LLM round trips; CodeMode with Monty took 9.1 s with 2. **[VENDOR]** — [Pydantic Monty article](https://pydantic.dev/articles/pydantic-monty)

#### 2.13 Windmill benchmarks
- Last run in 2025 on AWS m4.large. Windmill 1.483.1 is compared against Airflow 2.7.3, Prefect 2.14.4, Temporal 2.34.0, Kestra 0.22.3, and Hatchet 0.62.0. Tasks are `fibo(10)` (~10 ms) and `fibo(33/38)`, in Python, JS "where supported", and Go. The metrics are execution, assignment, and transition times. Per-language result pages were not retrieved. **[VENDOR]** — [Windmill benchmarks](https://www.windmill.dev/docs/misc/benchmarks/competitors)

### Inferences
- **Host-interop-heavy CPU ranking (Rust host):** Luau ≈ roto < Lua 5.5 < QuickJS (≈3×) < koto < Boa (≈7×) < Rhai (≈9.5×), relative to Luau. Rhai and Boa pay heavily for interop-heavy loops. Wasm with a compiled guest is fastest but is not a scripting language for LLM-written code unless a script interpreter is compiled to Wasm, which reintroduces interpreter cost.
- **JS engine choice for short, untrusted scripts:**
  - Interpreter-tier V8 (`--jitless`) is about 2.5× QuickJS on the V8 suite.
  - With JIT, V8 is about 18× its jitless mode. On plb2 compute kernels, Node with JIT beats no-JIT by 8.5–56×.
  - For code mode, most wall time is usually spent awaiting tool calls, so the per-session memory and the host-call cost likely matter more than peak JIT throughput. This is an inference to verify with the tool-call-scaling experiments.
- QuickJS (1.1 MB binary) and Lua (2.1 MB whole process) are an order of magnitude lighter than a Node process (50.7 MB baseline) at the process level. In-process marginal cost per session is unknown and is the main thing to measure.
- Pyodide's cold start without snapshots (seconds) makes snapshot or zygote strategies mandatory for Python-in-Wasm. Measure the CoW sharing of those snapshots via PSS/USS.
- Most density figures in the wild are vendor claims without methodology. Treat "few MB per isolate" (Cloudflare), "≤3.1 MB RSS" (Secure Exec, older), and "~5 MB" (Monty) as hypotheses to reproduce with the slope method.

### Gaps
- No current (2024+) cross-runtime **memory-per-instance** dataset exists for Lua/Luau states, QuickJS runtimes/contexts, V8 isolates, Wasmtime instances, Rhai/Rune engines, or Pyodide instances in one host.
- No current numbers found for **Rune** (dropped from script-bench-rs), **CPython on WASI** (startup, memory, CPU), or Pyodide CPU slowdown vs native CPython. Search found only older or indirect material, such as PyPy.js (asm.js era).
- Are We Fast Yet has no published results newer than 2016, although its Lua, Python, and JS ports are reusable.
- Windmill's per-language overhead numbers live on sub-pages I did not retrieve. Deno's density claims were not found.
- javascript-zoo does not state the benchmark hardware in `engines.json`.

## 3. Case studies: embedding a language/runtime for untrusted scripts

### Takeaway
Three patterns dominate:
- **In-process interpreters with capability-only host APIs** for short, high-volume scripts: Luau, Redis Lua, Envoy Lua, Shopify Javy/Wasm, Figma QuickJS-in-Wasm, Pydantic Monty.
- **V8 isolates** for JS at scale, backed by heavy defense in depth: Cloudflare, Convex, Supabase.
- **Process, container, or microVM isolation** for general-purpose code with packages: n8n external task runners, Windmill and Retool nsjail, Python in Excel containers, Val Town subprocesses, Netlify microVMs.

The 2019–2026 trend is away from language-level sandboxes inside a host VM (Realms, `node:vm`, vm2, Pyodide-in-Node) after repeated escapes. Published numbers are mostly limits, not measured marginal costs.

### Cited Findings

**Cloudflare Workers, Dynamic Workers, and Code Mode (V8 isolates)**
- Limits: 128 MB memory per isolate (JS heap plus Wasm allocations). CPU per HTTP request is 10 ms on Free; on Paid the default is 30 s and the maximum 5 min. Each request may hold 6 simultaneous outgoing connections, startup is capped at 1 s, and a Worker may be 64 MiB uncompressed. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Dynamic Worker Loader runs model-generated code in isolates. Tools are exposed as RPC stubs over a Cap'n Web bridge. HTTP can be intercepted with `globalOutbound`, and `null` fully isolates the sandbox. Pricing is $0.002 per unique Worker loaded per day (waived in beta). — [Cloudflare blog, 2026-03-24](https://blog.cloudflare.com/dynamic-workers)
- Cloudflare's defense in depth includes V8 patches deployed "within hours", a second-layer sandbox with "dynamic tenant cordoning", V8 sandbox extensions using MPK, and Spectre research with TU Graz. **[VENDOR]** — [Cloudflare blog](https://blog.cloudflare.com/dynamic-workers)
- Codemode's default execution timeout is 30,000 ms, and tool names with hyphens or dots are sanitized to JS identifiers. This comes from a search summary of the Cloudflare docs. — [Cloudflare codemode docs](https://developers.cloudflare.com/agents/api-reference/codemode)

**Netlify Edge Functions: V8 isolates replaced by microVMs (late 2026)**
- Each deploy now runs in its own Firecracker microVM, managed by Unikraft and restored from a memory-mapped snapshot. Netlify reports:
  - warm p50 "about 5–6ms, down from 25–40ms";
  - microVM creation "under 1ms";
  - p99 start about 2 ms.

  The previous isolate limits were 50 ms CPU per request, 512 MB memory, and 20 MB of compressed code. Netlify argues that "V8 isolates, no matter their name, do not provide this level of isolation". Requests also no longer leave Netlify's network to reach a hosted execution service. That likely explains part of the latency gain (my inference), so the before/after numbers do not isolate isolate-vs-microVM cost. **[VENDOR]** — [Netlify blog](https://www.netlify.com/blog/edge-functions-firecracker-microvms/)

**Figma plugins: Realms shim replaced by QuickJS compiled to Wasm [STALE 2019]**
- Several independent Realms-shim vulnerabilities could have allowed sandbox escape. Figma replaced the shim with "QuickJS… compiled to WebAssembly" because the Wasm VM's object representations are too different to confuse with host objects, and kept it as "intrinsically more secure". The trade-off is that QuickJS is "somewhat slower for certain plugins". Timeline: disclosure on Sept 14, Wasm runtime shipped Sept 25, 2019. — [Figma blog, 2019-10-02](https://www.figma.com/blog/an-update-on-plugin-security/)

**Shopify Functions: Wasm, Javy, and instruction limits**
- "For carts with up to 200 line items, a function can execute up to 11 million instructions", and the limit scales proportionally for larger carts. Exceeding it raises `InstructionCountLimitExceededError`. Modules can be up to 256 KiB (262,144 bytes); a sample benchmark showed 1088 KB of linear memory. JavaScript (compiled with Javy) executes "significantly more instructions than the equivalent Rust function". — [Shopify instruction counts](https://shopify.dev/docs/apps/build/functions/optimize-instruction-counts)

**Roblox Luau**
- Sandbox design:
  - `io` is removed, `os` and `debug` are reduced, and bytecode loading is disabled.
  - Readonly tables protect the builtins, and each script gets its own global table.
  - An interrupt handler enforces timeouts; the Studio watchdog defaults to 10 s.
  - "By default, no memory limits are imposed".
  - Writing the stack in a safer language like Rust would make the guarantees easier but "make it difficult to reach the level of performance required".

  — [Luau sandbox](https://luau.org/sandbox)
- Performance claims: "noticeably faster than Lua 5.x", and on some workloads it "can match the performance of LuaJIT interpreter". An optional user-directed JIT exists for x64 and arm64. The GC is incremental with PID-controller pacing. Values are 16 bytes, with a custom allocator. **[VENDOR]** — [Luau performance](https://luau.org/performance)

**Redis and Valkey Lua**
- Redis supports a single engine, Lua 5.1. Scripts run atomically and block the whole server. The maximum execution time defaults to 5 s (`busy-reply-threshold`); once exceeded, Redis answers BUSY, and `SCRIPT KILL` works only if the script has not written. — [Redis programmability](https://redis.io/docs/latest/develop/programmability/)
- Every `EVAL`'d script is cached by SHA1, and "Generating scripts during the application's runtime may, and probably will, exhaust the host's memory". This is directly relevant to unique, LLM-generated scripts. — [Redis eval intro](https://redis.io/docs/latest/develop/programmability/eval-intro/)
- Valkey 9.1 moved the Lua engine into a loadable module (`libvalkeylua.so`), so Lua can be disabled and other engine versions added later. — [Valkey 9.1 blog](https://valkey.io/blog/valkey-9-1-delivers-improvements-in-security-performance-and-more/)

**Envoy: Lua, Proxy-Wasm, and dynamic modules**
- The Lua filter uses LuaJIT with "All Lua environments are per worker thread". Scripts run as coroutines, and `httpCall()` suspends until the call completes. The docs warn that "A Lua VM is not only an amount of memory, it is also a set of Lua globals that outlive a request". `shared_vm_id` and the `lua_vm_count` gauge manage this cost. — [Envoy Lua filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/lua_filter)
- Dynamic modules (native shared libraries) aim for "minimal overhead compared to the built-in C++ extensions" and zero-copy header and body access. They must be "fully trusted", and the feature is under active development. — [Envoy dynamic modules](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/advanced/dynamic_modules)
- Third-party sources attribute Wasm's lower performance to cross-VM serialization. An older O'Reilly chapter cites 10–20% overhead versus native for some network filtering. — [Jimmy Song blog](https://jimmysong.io/en/blog/envoy-extension-vs-integration); [O'Reilly ch. 4](https://www.oreilly.com/library/view/the-enterprise-path/9781492089353/ch04.html)

**Fluent Bit: Wasm filters**
- Runs on WAMR (with the `flb-wamrc` AOT compiler). Guests can be C (WASI SDK), Rust, or TinyGo. ABI v2 returns a single JSON or MessagePack map, and AOT is pitched for "best performance". — [Fluent Bit Wasm filters](https://docs.fluentbit.io/manual/development/wasm-filter-plugins)

**Zed extensions: Wasmtime and the Component Model [2024-10-21]**
- Extensions are Rust compiled to Wasm and loaded into Wasmtime. The API is defined in WIT, with host bindings generated by `wasmtime::component::bindgen!` using `async: true`. The team considered embedding JS through Deno's V8 bindings but wanted to write extensions in Rust. The Component Model "allows us to pass strings, structs, arrays". No performance numbers are given. — [Zed blog](https://zed.dev/blog/zed-decoded-extensions)

**n8n Code node: vm2, then task runners; Pyodide escape**
- Task runners connect to an n8n broker over WebSocket. Internal mode (a child process) is "insecure by design" and deprecated from n8n 3.0. External mode, where a launcher runs the runners in the `n8nio/runners` sidecar container, is recommended for production. `N8N_RUNNERS_ENABLED` is no longer needed from 2.0. — [n8n task runners](https://docs.n8n.io/hosting/configuration/task-runners)
- CVE-2025-68668 (GHSA-62r4-hw23-cc8v): a sandbox bypass in the Pyodide-based Python Code node lets authenticated workflow editors execute arbitrary host commands. It affects 1.0.0 up to (not including) 2.0.0 and is fixed in 2.0.0. — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-68668)
- Native Python runs through task runners from v1.111.0 and is stable in v2. On n8n Cloud, Python cannot import libraries. — [n8n Code node docs](https://docs.n8n.io/code/code-node)
- One community post says isolated-vm became a dependency of `@n8n/expression-runtime` and broke on Node 24's V8 ABI. Low confidence: single community source. — [n8n community](https://community.n8n.io/t/psa-v2-8-x-external-task-runner-broken-need-better-qa/274973?tl=en)

**Windmill: nsjail**
- nsjail is "disabled by default". It provides filesystem isolation, optional network restrictions, and CPU, memory, and process limits. Python and Ansible get `rlimit_as` 4096 MiB by default. PID-namespace isolation via `unshare` is an alternative. Dedicated workers do not use nsjail, and `EXIT_AFTER_N_JOBS` recycles workers. — [Windmill security isolation](https://www.windmill.dev/docs/advanced/security_isolation)

**Val Town: vm → vm2 → Deno workers → Deno subprocesses [2024-02-08]**
- `node:vm` was easy to escape, and infinite loops could take down the server. With vm2 "it was impossible to add security to an unsecure construct". Deno Workers were fast, but escapes were still possible (a worker inside a worker) and memory degraded over time. The fourth runtime uses temporary Deno subprocesses with a pre-initialized process pool, and the team "just cut 100ms from typical val runtimes". — [Val Town blog](https://blog.val.town/blog/first-four-val-town-runtimes)

**Supabase Edge Functions**
- Limits: 256 MB memory; 2 s CPU per request (async I/O excluded); wall clock 150 s on Free and 400 s on paid plans; 150 s idle timeout. Bundles may be 20 MB via the CLI or 5 MB when bundled server-side. Web Workers and Node `vm` are unavailable. — [Supabase limits](https://supabase.com/docs/guides/functions/limits)

**Convex**
- Function runner on V8. Queries must be deterministic, with determinism enforced "by directly using V8's runtime". Mutations are sandboxed with no `fetch`. An automatic, always-consistent result cache avoids spinning up "a V8 isolate". Latencies are "in the milliseconds". The post is undated. — [How Convex works](https://stack.convex.dev/how-convex-works)

**Google Apps Script**
- Script runtime is 6 min per execution and custom functions 30 s. Limits are 30 simultaneous executions per user and 1,000 per script. URL Fetch is 20,000/day (consumer) or 100,000/day (Workspace), with 50 MB per response. — [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)

**Python in Excel**
- Code runs in "hypervisor isolated containers built on Azure Container Instances" under a least-privileged account with "no network access" and no user token. It uses curated Anaconda libraries and persists no data. — [Microsoft support](https://support.microsoft.com/office/data-security-and-python-in-excel-33cc88a4-4a87-485e-9ff9-f35958278327)
- A 2026 SafeBreach report (CVE-2026-45459) says a Python-generated web-image object could make Excel itself issue a network request. Unverified: not checked against a primary advisory. — [Microsoft support page via search](https://support.microsoft.com/en-us/excel/python/data-security-and-python-in-excel)

**Retool**
- Workflow code runs in a code-executor container using NsJail. Modes, from most to least secure: a custom seccomp profile (recommended, no `CAP_SYS_ADMIN`), privileged, and unprivileged. In unprivileged mode you "must fully trust all user-written code". NsJail is no longer required for custom JS and Python libraries. — [Retool custom code execution security](https://docs.retool.com/self-hosted/concepts/custom-code-execution-security); [Retool changelog](https://docs.retool.com/changelog/workflow-libaries-without-nsjail)

**Zapier (Code by Zapier)**
- Runtime limits are 1 s on Free, 30 s on Professional and Team, and 2 min on Enterprise. Memory is 512 MB on every plan, and extended runtimes reach up to 10 min. Older help pages said 128 MB or 256 MB, which conflicts. — [Zapier help](https://help.zapier.com/hc/en-us/articles/45405528551181); [older increased-timeouts page](https://help.zapier.com/hc/en-us/articles/14166919366413-Run-more-Code-by-Zapier-steps-with-increased-timeouts-and-throttle-limits)

**Pipedream**
- Memory defaults to 256 MB, configurable up to 10 GB. Timeouts default to 30 s (HTTP/email) or 60 s (cron) and can be raised to 300 s self-serve. Each step runs as a separate process, so workflows with roughly 8–10 or more steps can hit memory limits. Each workflow gets 512 MB of `/tmp`. — [Pipedream settings](https://pipedream.com/docs/workflows/building-workflows/settings/); [Pipedream limits](https://pipedream.com/docs/workflows/limits)

**Pydantic Monty (a code-mode-specific interpreter, 2026)**
- A from-scratch Python bytecode VM in Rust that uses Ruff's parser. It calls back into the host at external functions, with async and `asyncio.gather` support. Snapshots serialize execution "mid-flight to bytes", so it can resume later or elsewhere. Bindings exist for Python, JS, and Rust. **[VENDOR]** — [Pydantic Monty](https://pydantic.dev/articles/pydantic-monty)
- Default `run_code` limits are 30 s, 256 MiB, and 100 nested tool calls. It runs in a pool of worker processes. There is no filesystem, network, environment, or clock unless the host passes them in. "Code mode is not a sandbox": tools still run with the agent's access. — [Code mode is not a sandbox](https://pydantic.dev/articles/code-mode-vs-sandboxes)

**isolated-vm (used by several Node hosts)**
- The project is in "maintenance mode". `memoryLimit` defaults to 128 MB (minimum 8 MB) but is "more of a guideline"; attackers may use 2–3× it. Each isolate "holds a large chunk of memory", so call `dispose()` when done. The docs advise running isolated-vm in a separate process from critical infrastructure. — [isolated-vm README](https://github.com/laverdet/isolated-vm)

### Inferences
- **Decision drivers seen across cases:**
  1. Escape history of the in-host sandbox: Figma Realms, Val Town vm2, n8n Pyodide.
  2. Need for third-party packages or native libraries, which pushes toward process or VM isolation: n8n, Windmill, Retool, Python in Excel.
  3. Determinism and metering, using instruction or fuel counts: Shopify, Redis's atomicity model, Convex.
  4. Density and latency for very high request rates, which favours isolates or interpreters: Cloudflare, Luau.
- Netlify moving off isolates in 2026 and Cloudflare doubling down on them for code mode in 2026 show that isolation strength versus density is a live trade-off. Our benchmark should report security posture next to efficiency.
- Limits published by Cloudflare (128 MB), Supabase (256 MB), Monty (256 MiB), Zapier (512 MB), and Pipedream (256 MB default) are reasonable settings for "production limits on" runs, and a reference for what per-session budgets platforms tolerate.
- Redis's script-cache warning applies to LLM-generated scripts in general. Any runtime that caches compiled code per unique source (V8 code cache, Lua/Luau bytecode caches, Wasmtime module caches) needs bounded caches. Measure memory growth over many unique scripts, not only over many sessions.

### Gaps
- No primary performance or memory numbers were found for the Figma QuickJS switch, Shopify's runtime (Wasmtime is not named on the fetched page), Envoy's default Proxy-Wasm runtime, the Fluent Bit Lua filter, Convex isolate reuse, Retool executor overhead, nsjail overhead (Windmill gives none), or Zapier/Pipedream execution backends.
- Not verified this session: reports of 2025 Redis Lua sandbox RCEs, Supabase Edge Runtime internals (Deno-based per common knowledge, not stated on its limits page), and whether Netlify's microVMs still run Deno.

## 4. Detailed methodology: memory (key question 1)

### Takeaway
Use cgroup `memory.current` with its `memory.stat` breakdown as the system-of-record total, PSS/USS from `smaps_rollup` for attribution, and runtime heap statistics for diagnosis. Derive marginal cost as a fitted slope over N live sessions at defined lifecycle states after controlled GC and allocator purging. Report virtual reservations and page tables separately from resident memory.

### Cited Findings
**Kernel and process interfaces**
- PSS: "the count of pages it has in memory, where each page is divided by the number of processes sharing it". For example, 1000 private pages plus 1000 pages shared with one other process gives PSS 1500. `smaps_rollup` adds `Pss_Anon`, `Pss_File`, and `Pss_Shmem`, and also reports `Pss_Dirty`, `Shared_Clean`, `Shared_Dirty`, `Private_Clean`, `Private_Dirty`, `Anonymous`, `KSM`, `LazyFree` (`MADV_FREE`), `AnonHugePages`, `Swap`, `SwapPss`, and `Locked`. — [Linux proc docs](https://docs.kernel.org/filesystems/proc.html)
- Reading `/proc/PID/maps` or `smaps` is "inherently racy". `smaps_rollup` is "faster and more convenient" than summing `smaps`. — [Linux proc docs](https://docs.kernel.org/filesystems/proc.html)
- `memory.stat` fields:
  - `anon`: `brk`, `sbrk`, `mmap(MAP_ANONYMOUS)`.
  - `file`: cache, including tmpfs and shared memory.
  - `kernel`: covers `kernel_stack`, `pagetables`, `percpu`, `vmalloc`, and slab.
  - `sock`: "network transmission buffers".
  - `shmem`: swap-backed cache.
  - `file_mapped`.
  - `slab_reclaimable` and `slab_unreclaimable`.

  — [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- `memory.reclaim` triggers reclaim, but "the kernel can over or under reclaim". With `memory.high` processes are throttled rather than OOM-killed; `memory.max` invokes the OOM killer. Charging of shared areas between cgroups is "in-deterministic". — [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- Writing to `memory.peak` resets it for the same fd. A 2026 patch reports that a reset on one fd lowered the shared watermark and clobbered other fds' readings, and proposes a fix; I could not confirm it was merged. — [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html); [LKML patch](https://lkml.iu.edu/2607.3/13090.html)
- `getrusage`: `ru_maxrss` is "the maximum resident set size used (in KiB)". `RUSAGE_THREAD` has existed since Linux 2.6.26. — [getrusage(2)](https://man7.org/linux/man-pages/man2/getrusage.2.html)
- KSM operates only on areas marked with `madvise(MADV_MERGEABLE)`. Per-process stats live in `/proc/<pid>/ksm_stat` (`ksm_merging_pages`, `ksm_process_profit`). "KSM's scans may use a lot of processing power". — [KSM docs](https://docs.kernel.org/admin-guide/mm/ksm.html)

**Allocators**
- glibc: `M_ARENA_MAX` defaults to 0, so the arena cap comes from `M_ARENA_TEST`, which is 8 on 64-bit. The hard limit is "usually calculated as a multiple of the number of available CPUs". `M_TRIM_THRESHOLD` and `M_MMAP_THRESHOLD` start at 128 KiB and adjust dynamically. The `MALLOC_ARENA_MAX`, `MALLOC_TRIM_THRESHOLD_`, and similar environment variables must be set before the first allocation. — [mallopt(3)](https://man7.org/linux/man-pages/man3/mallopt.3.html)
- `malloc_trim`: "Since glibc 2.8 this function frees memory in all arenas and in all chunks with whole free pages". — [malloc_trim(3)](https://man7.org/linux/man-pages/man3/malloc_trim.3.html)
- jemalloc: "Decay time determines how fast jemalloc returns unused pages back to the operating system". A low-resource example uses `dirty_decay_ms:1000,muzzy_decay_ms:0`. Background threads shift purging off application threads, and a high arena count increases fragmentation. — [jemalloc TUNING.md](https://github.com/jemalloc/jemalloc/blob/dev/TUNING.md)
- mimalloc: `MIMALLOC_PURGE_DELAY` is 1000 ms by default in v3. Purging decommits by default, and `MIMALLOC_ARENA_EAGER_COMMIT=2` eagerly commits on overcommit systems. Current versions: v3.6.1 (2026-10-30) and v2.5.2. — [mimalloc README](https://github.com/microsoft/mimalloc)

**Runtime reservations and pooling**
- Wasmtime 50.0.1 on 64-bit: `memory_reservation` 4 GiB, `memory_guard_size` 32 MiB, `memory_reservation_for_growth` 2 GiB, `memory_may_move` true, `consume_fuel` false. — [Wasmtime Config docs](https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html)
- Wasmtime pooling allocator:
  - "roughly 4G of virtual memory per WebAssembly linear memory slot", so at most about 32k slots on many systems; `total_memories` defaults to 1000.
  - Deallocation resets memory with `madvise`. `linear_memory_keep_resident` uses `memset` instead and keeps RSS.
  - MPK packing is experimental and off by default.
  - The pool "may keep memory alive when nothing is using it", and slot usage "can impact the overall RSS usage". — [PoolingAllocationConfig](https://docs.rs/wasmtime/latest/wasmtime/struct.PoolingAllocationConfig.html)
- Wasmtime CoW heap images defer copying until first write. `InstancePre` moves import resolution off the instantiation path. — [Wasmtime fast instantiation](https://docs.wasmtime.dev/examples-fast-instantiation.html)
- The V8 sandbox reserves "currently one terabyte" of virtual address space and costs about 1% or less on typical workloads. It is on by default in 64-bit Chrome (2024-04-04). — [V8 sandbox blog](https://v8.dev/blog/sandbox)
- V8 isolate groups give separate pointer-compression cages. Node's pointer-compression build is opt-in via `node-caged` images. **[VENDOR]** for the savings claim. — [Platformatic blog](https://blog.platformatic.dev/we-cut-nodejs-memory-in-half)

**Runtime-level memory introspection and limits**
- isolated-vm: `getHeapStatistics()` matches Node's and adds `externally_allocated_size`, which is counted against `memoryLimit`. — [isolated-vm README](https://github.com/laverdet/isolated-vm)
- Node: `v8.getHeapStatistics()` returns heap totals, `malloced_memory`, and `external_memory`; `process.memoryUsage()` returns `rss`, `heapTotal`, `heapUsed`, `external`, and `arrayBuffers`. — [Node v8 API](https://nodejs.org/api/v8.html#v8getheapstatistics); [Node process API](https://nodejs.org/api/process.html#processmemoryusage)
- Lua: `collectgarbage("count")` returns the memory in use by Lua in KB. — [Lua 5.4 manual](https://www.lua.org/manual/5.4/manual.html#pdf-collectgarbage)
- Luau keeps `collectgarbage("count")` in its sandboxed globals and imposes no memory limit by default. — [Luau sandbox](https://luau.org/sandbox)
- mlua: `Lua::used_memory` and `set_memory_limit`. rquickjs: `Runtime::memory_usage` and `set_memory_limit`. — [mlua docs](https://docs.rs/mlua/latest/mlua/struct.Lua.html); [rquickjs docs](https://docs.rs/rquickjs/latest/rquickjs/struct.Runtime.html)
- QuickJS uses reference counting with cycle removal "to reduce memory usage and have deterministic behavior". — [QuickJS homepage](https://bellard.org/quickjs/)
- Rust std threads default to a 2 MiB stack, which matters for thread-per-suspended-session designs. — [Rust std::thread docs](https://doc.rust-lang.org/std/thread/index.html#stack-size)

### Inferences
- **Primary marginal metric:** Δ`memory.current` of the experiment cgroup per added session (anon + kernel + file), with the breakdown reported. It is the only number that charges process-per-session designs for kernel memory (page tables, kernel stacks) and in-process designs for allocator retention on equal terms. Add **ΣPSS** across the cgroup's processes, and **USS slope**, the memory freed per session killed.
- **Fair in-process vs process-per-session comparison:** hold the same session state (S1–S4) and the same quiescence protocol, and report:
  1. the fixed cost a, which covers host, zygote, pool, and snapshot;
  2. the marginal b per session;
  3. peak per script;
  4. the time to provision a session from a warm pool.

  Process pools and zygotes move cost from b to a, so always show both, and show the total at the target N (for example 1,000 concurrent sessions).
- **Shared-page attribution:** V8 startup snapshots, Wasmtime memfd CoW images, Pyodide memory snapshots, and fork zygotes show up as `Shared_Clean` or `Pss_File` until written. Measure after S2 to see how much sharing survives. KSM can recover more sharing at a CPU cost. Treat KSM as a separate experiment and record `ksm_stat`. I believe process-wide KSM is available via `prctl(PR_SET_MEMORY_MERGE)` on newer kernels, but the fetched KSM doc did not mention it, so verify before relying on it.
- **Allocator retention:** run every runtime under the same allocator configuration, and also under a "trim" protocol. Otherwise glibc's per-CPU arenas (up to 8 × cores on 64-bit; the exact multiplier was not on the fetched page) or mimalloc's 1 s purge delay can add tens of MB of "phantom" per-session cost after bursts. The gap between natural and trimmed slopes is itself a finding, because production sees the natural value.
- **Wasm memories cannot shrink:** core Wasm has a grow instruction and no shrink. A session whose peak touched X MB keeps X MB until destroyed unless the host recycles the instance. With Wasmtime pooling, deallocation resets via `madvise` unless `keep_resident` keeps it. Measure post-run retention for Pyodide, QuickJS-wasm, and CPython-WASI separately.
- **Virtual vs resident:** report `VmSize` and mapping counts per session. A 4 GiB-plus-guard reservation per Wasm memory, or V8's 1 TB sandbox, costs no RSS. They can still fail under `RLIMIT_AS` (nsjail-style limits) or `vm.max_map_count`, and they cost page-table memory when touched sparsely; watch the `pagetables` slope.
- **Runtime counters versus OS numbers:** the gap between the runtime-heap slope (V8 `used_heap_size` + `external_memory`, `lua_gc` count, QuickJS memory usage, Wasm memory byte length) and the OS slope gives native overhead: code space, thread stacks, binding objects, and allocator slack. Large gaps are bugs or design costs worth reporting.
- **THP:** check `AnonHugePages` in `smaps_rollup`. With THP set to `always`, small per-session heaps may be rounded up to 2 MiB pages, which distorts slopes. Run with the production THP setting and record it.

### Gaps
- No authoritative per-instance memory figures were found for Lua/Luau states, QuickJS runtimes/contexts, Rhai/Rune engines, or Wasmtime instances with CoW. These must be measured.
- I did not verify the exact glibc arena multiplier (commonly cited as 8 × cores on 64-bit), the default of Wasmtime's `memory_init_cow`, or the kernel version that added `PR_SET_MEMORY_MERGE`.

## 5. Detailed methodology: CPU (key question 2)

### Takeaway
Count CPU at the cgroup level per completed script (`cpu.stat usage_usec`) and attribute it per thread with `schedstat`, because runtimes use helper threads. Use hardware counters (instructions, cycles) for low-noise A/B microbenchmarks. Separate host marshaling from guest compute with call-count and payload-size slopes. Treat JIT warm-up as a first-class result, and apply multi-level repetition with nonparametric statistics.

### Cited Findings
- `cpu.stat` always reports `usage_usec`, `user_usec`, and `system_usec`. When the controller is enabled it also reports `nr_periods`, `nr_throttled`, and `throttled_usec`. These are non-hierarchical; `cpu.stat.local` includes inherited throttling. — [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- `RUSAGE_SELF` is summed across all threads, while `RUSAGE_THREAD` covers only the calling thread. `ru_nvcsw` and `ru_nivcsw` count voluntary and involuntary context switches. — [getrusage(2)](https://man7.org/linux/man-pages/man2/getrusage.2.html)
- CPU time can exceed elapsed time because runtimes use extra threads for GC or JIT. — [plb2 README](https://github.com/attractivechaos/plb2); [hanabi1224 helloworld page](https://programming-language-benchmarks.vercel.app/problem/helloworld)
- isolated-vm exposes `cpuTime` and `wallTime` in ns. A call into another isolate increases wall time but not CPU time, and CPU time varies under contention. — [isolated-vm README](https://github.com/laverdet/isolated-vm)
- Sightglass splits compilation, instantiation, and execution. It measures cycles by default, plus instructions retired, perf counters, or callgrind, and applies Mann–Whitney U with effect sizes. — [Sightglass README](https://github.com/bytecodealliance/sightglass)
- Barrett et al. ran 30 fresh process executions per ⟨VM, benchmark⟩ and used changepoint analysis. Only 30.0–43.5% of pairs consistently reached a steady state of peak performance. — [arXiv 1602.00602](https://arxiv.org/abs/1602.00602v6)
- Kalibera & Jones (ISMM 2013): repetition is needed at several levels (iterations, executions, builds). They give a cookbook for choosing counts at each level and report results as effect-size CIs. — [bibtex/abstract](https://bibtex.github.io/ISMM-2013-KaliberaJ.html); [Kent repository](https://kar.kent.ac.uk/id/document/3127886)
- The "benchmarking crimes" study surveyed about 50 defense papers and identified 22 flaws. Tier-1 papers averaged five crimes, and only one paper had none. The EuroS&P 2019 version is titled "SoK: Benchmarking Flaws in Systems Security". — [VUSec project page](https://www.vusec.net/projects/benchmarking-crimes/); [arXiv 1801.02381](https://ar5iv.labs.arxiv.org/html/1801.02381)
- The Benchmarks Game varies UNIX environment size to reduce bias, excludes the first run, and reports CIs. — [CLBG measurement](https://benchmarksgame-team.pages.debian.net/benchmarksgame/how-programs-are-measured.html)
- Frank Denis disabled boost and fixed 2 GHz, and notes that `-Diterations=3` makes tiny tests "noisy and quantized". Even careful public benchmarks carry known noise. — [00f.net 2026](https://00f.net/2026/06/23/webassembly-runtimes-2026/)
- Interpreter vs JIT gap: V8 `--jitless` scores about 1/18 of V8 with JIT on the V8 v7 suite (computed from [engines.json](https://zoo.js.org/engines.json)). Node without JIT is 8.5–56× slower than with JIT on plb2 kernels (computed from [plb2](https://github.com/attractivechaos/plb2)).
- Wasmtime: `consume_fuel` (deterministic, off by default) vs `epoch_interruption` ("lightweight, non-deterministic"). Shopify meters with instruction counts. — [Wasmtime Config](https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html); [Shopify](https://shopify.dev/docs/apps/build/functions/optimize-instruction-counts)
- Tools: `pyperf system tune` ([pyperf docs](https://pyperf.readthedocs.io/en/latest/system.html)), LLVM's benchmarking tips ([LLVM](https://llvm.org/docs/Benchmarking.html)), hyperfine with warmups, prepare commands, and JSON export ([hyperfine](https://github.com/sharkdp/hyperfine)), criterion's bootstrap analysis ([criterion book](https://bheisler.github.io/criterion.rs/book/analysis.html)), `perf stat` ([man perf-stat](https://man7.org/linux/man-pages/man1/perf-stat.1.html)), per-thread schedstat ([sched-stats docs](https://docs.kernel.org/scheduler/sched-stats.html)), and off-CPU analysis for async waits ([Brendan Gregg](https://www.brendangregg.com/offcpuanalysis.html)).

### Inferences
- **Per-script CPU** = Δ`usage_usec` over a measurement window divided by scripts completed, at a fixed open-loop rate below saturation, reported with the user/system split. System time captures syscalls, futex wakeups, and IPC for process-per-session designs.
- **Attribution:** name threads in the harness (guest executor, host event loop or tokio workers, HTTP client). Read `/proc/PID/task/*/schedstat` before and after to split guest compute, host marshaling, and runtime helper threads (V8 GC/compile, Wasmtime parallel compilation at module load). Use `perf record -g` flame graphs on the host-call microbenchmark to locate serialization hot spots, and off-CPU flame graphs for suspended or awaiting sessions.
- **Host-call overhead model:** time(n, s) = c + n·(t_call + s·t_byte), fit across n ∈ {1, 10, 100, 1 000, 10 000} and s ∈ {0, 1 KB, 1 MB}. The expected ordering by per-byte cost is: direct handles (userdata, `Reference`) < zero-copy ArrayBuffer transfer < structured clone or CBOR/MessagePack < JSON. This ordering is to be verified. The script-bench-rs ordering (Luau < Lua < QuickJS < Boa < Rhai on interop-heavy sorting) is a prior to test.
- **Cold vs warm:**
  - **Cold** = new process: hyperfine with `--warmup 0` and many runs, pinned.
  - **Warm-engine** = new session in a warm host: in-process timer.
  - **Hot** = reused session, which matters for snapshot or pool designs.
  - Code-mode scripts run once, so report "first execution" CPU as the headline and steady state as secondary.
- **Repetition plan:** ≥10 (preferably 30) fresh process executions × ≥10 iterations per configuration. Report medians with bootstrap 95% CIs and compare configurations with Mann–Whitney U. Report absolute values, never only ratios.
- **PMU access:** many cloud VMs restrict hardware counters, and `perf_event_paranoid` gates `perf stat` for unprivileged users. Plan for bare metal or verify counter availability. This is an inference from common practice; no source fetched.
- **Limits enabled:** measure with production metering on (fuel or epochs, Lua hooks, V8 interrupts/`TerminateExecution`, Rhai max-operations), because metering changes CPU cost.

### Gaps
- No published cross-runtime numbers for host-call round-trip cost across payload sizes or serialization formats were found. script-bench-rs is the closest proxy, and it covers only one workload.
- No current data was found on JIT warm-up curves for short, one-shot scripts of the size LLMs write (tens to hundreds of lines).

## 6. Detailed methodology: load generation, async host calls, and tool-call scaling (key question 3)

### Takeaway
Use an open-loop arrival schedule with latency measured from the intended start time, recorded in HdrHistogram. Sweep the rate up to saturation under a fixed CPU budget set by `cpu.max` and a cpuset. Measure memory per suspended session awaiting slow host calls as a slope, and fit CPU and memory against the number of tool calls per script for both serial chains and parallel fan-out.

### Cited Findings
- k6: "In a closed model, the execution time of each iteration dictates the number of iterations executed"; in the open model, VUs "arrive independently of iteration completion". k6's open-model executors are `constant-arrival-rate` and `ramping-arrival-rate`, and k6 names the closed-model problem coordinated omission. — [k6 open vs closed](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/)
- wrk2 takes a fixed `-R` rate, measures from the intended send time, and records lossless HdrHistograms. In its quiet example, corrected p99 was 10.52 ms against an uncorrected 5.43 ms. — [wrk2 README](https://github.com/giltene/wrk2)
- cgroup v2 `cpu.max` sets quota and period ("$MAX $PERIOD") for a fixed CPU budget. — [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- Async host-call designs in use:
  - Cloudflare exposes tools as RPC stubs via Cap'n Web ([Cloudflare](https://blog.cloudflare.com/dynamic-workers)).
  - Envoy Lua coroutines suspend on `httpCall()` ([Envoy](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/lua_filter)).
  - Zed uses async Wasmtime component bindings ([Zed](https://zed.dev/blog/zed-decoded-extensions)).
  - Monty pauses at external functions, supports `asyncio.gather`, and can snapshot mid-flight to a few KB ([Pydantic](https://pydantic.dev/articles/pydantic-monty)).
  - Redis Lua is synchronous and blocks the server ([Redis](https://redis.io/docs/latest/develop/programmability/)).
- Monty defaults to 100 nested tool calls per `run_code`, and Cloudflare codemode to a 30 s execution timeout. These are reference limits for fan-out tests. — [Pydantic](https://pydantic.dev/articles/code-mode-vs-sandboxes); [Cloudflare codemode docs](https://developers.cloudflare.com/agents/api-reference/codemode)
- isolated-vm moves values via `ExternalCopy` (structured clone for objects) and `Reference`, and can transfer ArrayBuffers without copying (`transferOut`/`transferIn`). Untrusted code must never be given `Reference` or `ExternalCopy` objects. — [isolated-vm README](https://github.com/laverdet/isolated-vm)
- Open-vs-closed workload modelling originates with Schroeder, Wierman & Harchol-Balter, "Open Versus Closed: A Cautionary Tale" (NSDI 2006) **[STALE but foundational]**. — [USENIX](https://www.usenix.org/conference/nsdi-06/open-versus-closed-cautionary-tale)

### Inferences
- **Generator design:** precompute an arrival schedule (Poisson or constant). Each arrival starts a session that runs a script; latency = completion − scheduled start. Record per-phase histograms: queue wait, session acquire, guest run, each host call, and total. Merge HdrHistograms across workers rather than averaging percentiles.
- **Workloads to sweep:**
  - **W1:** empty script, to measure session overhead.
  - **W2:** serial chain of k calls to a host tool with delay D.
  - **W3:** parallel fan-out of k calls with delay D.
  - **W4:** data processing on a 1 MB JSON tool result (parse, filter, aggregate).
  - **W5:** artifact generation (string or buffer building, 1–10 MB output).
  - **W6:** HTTP fetch via the host tool vs the embedded client (section 7).

  Use k ∈ {0, 1, 10, 100, 1 000}, D ∈ {0, 1 ms, 50 ms, 1 s}, and payloads of 0 B, 1 KB, 1 MB.
- **Slopes to fit:**
  - CPU per tool call: Δusage/Δk at D = 0.
  - Memory per pending call: Δpeak/Δk for parallel fan-out at large D.
  - Latency overhead per call: serial latency − k·D.
  - Concurrency gain: parallel vs serial latency, with the expectation D + k·o versus k·(D + o).

  Deviations point to serialization at the boundary (a single-threaded host, or a runtime that cannot overlap awaits).
- **Suspended-session memory:** start N sessions that each await a host call resolving after 30–60 s. Measure the slope of `memory.current` vs N, and idle CPU over the wait, which should be ≈0. Runtimes without native async (Rhai and Rune from Rust; synchronous Lua without coroutines) need a thread or an explicit continuation per waiting session. Snapshot-capable designs (Monty) can drop live state while waiting. Include a variant that snapshots and evicts.
- **Fixed CPU budget:** with `cpu.max` at 2 CPUs and a matching cpuset, raise λ until p99 exceeds the SLO, for example 2× the unloaded p99. The reported capacity is scripts/s/core at the SLO. Memory at that operating point follows from Little's law: in-flight sessions = λ × mean latency, times the per-session slope.

### Gaps
- No public benchmark measures memory per suspended script awaiting host calls, or tool-call-count scaling, for any of the candidate runtimes. This is novel work for our harness.

## 7. Detailed methodology: real HTTP inside benchmarks (key question 4)

### Takeaway
Use a local, controllable HTTP server in its own cgroup and on its own cores. Control delay, size, keep-alive, and TLS per request, and inject network RTT with netem or Toxiproxy. Then attribute CPU and memory between the host HTTP engine and the embedded client using per-thread CPU, `memory.stat sock`, connection counts, and the slope of memory per in-flight request.

### Cited Findings
- `memory.stat sock` reports "memory used in network transmission buffers", which are charged to the cgroup. — [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- TLS memory per connection: a rustls session peaks at about 13 KiB against about 69 KiB for OpenSSL, and C10K totals are 132 MiB vs 688 MiB (Dec 2023 benchmark, reported Jan 2024; borderline stale). — [ISRG/Prossimo rustls blog](https://www.memorysafety.org/blog/rustls-performance/); [rustls BENCHMARKING.md](https://github.com/rustls/rustls/blob/main/BENCHMARKING.md)
- Platform HTTP limits that shape real usage:
  - Cloudflare allows 6 simultaneous outgoing connections per request; the seventh waits for headers ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).
  - Cloudflare's `globalOutbound` callback intercepts sandbox HTTP and supports credential injection ([Cloudflare blog](https://blog.cloudflare.com/dynamic-workers)).
  - Apps Script caps URL Fetch at 20k/100k calls per day and 50 MB per response ([Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)).
  - Python in Excel has no network access ([Microsoft](https://support.microsoft.com/office/data-security-and-python-in-excel-33cc88a4-4a87-485e-9ff9-f35958278327)).
- Envoy Lua runs HTTP through the host (`httpCall` suspends the coroutine) and warns "Do not perform blocking operations from scripts". — [Envoy Lua filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/lua_filter)
- Tools for controlled latency and payloads: Toxiproxy latency and bandwidth toxics ([Toxiproxy](https://github.com/Shopify/toxiproxy)), netem delay, jitter, loss, and rate ([tc-netem(8)](https://man7.org/linux/man-pages/man8/tc-netem.8.html)), and go-httpbin's `/delay`, `/bytes`, and `/drip` endpoints ([go-httpbin](https://github.com/mccutchen/go-httpbin)).

### Inferences
- **Server:** a small Rust hyper/axum server (or go-httpbin) with query parameters `delay_ms`, `bytes`, `chunk_ms`, `status`, and `close`. It should count accepted connections and TLS handshakes and expose them on a stats endpoint. Serve HTTP/1.1 and h2, with and without TLS, using a local CA so certificate verification stays on. Pin it to separate cores in its own cgroup so its CPU never lands in the SUT numbers.
- **Network:** put client and server in separate network namespaces connected by a veth pair, and apply `tc qdisc … netem delay Xms` there, or route through Toxiproxy. Verify the effective RTT. On a shared interface, netem applies on egress, so the RTT effect depends on where it is attached. Use RTTs of 0.1, 1, 20, and 80 ms to mimic local, same-AZ, same-region, and cross-region.
- **Two client paths:**
  - **(a) Host-provided fetch tool.** The guest calls `fetch` as a host function, and the host's engine (reqwest/hyper or undici) owns the pool and TLS. It is shared across sessions, connections stay warm, and memory per in-flight request sits mostly in the host.
  - **(b) Runtime-embedded client.** Examples: CPython `urllib3`/`requests` with OpenSSL inside each process, Pyodide calling JS `fetch` through the host, and WASI-HTTP implemented by the host anyway. Pools are often per session, which multiplies connections and TLS state per session.

  Attribute CPU by thread (host I/O threads vs guest thread) and memory by the slope of `memory.current` and `sock` against concurrent in-flight requests, holding responses open with `delay_ms`.
- **Metrics per configuration:**
  - CPU per request (cgroup Δ/requests);
  - memory per in-flight request (slope);
  - connections established (`ss -Htn state established`);
  - handshakes per request (server counter; ideally ≪1 with pooling);
  - p50/p99 latency under the open-loop rate;
  - bytes copied across the guest/host boundary (body size × copies).
- **Pooling effects:** compare keep-alive on and off, pool sizes of 1, 6 (the Cloudflare-like cap), and unlimited, and TLS on and off. Handshake CPU per request falls sharply with reuse, so report both "first request" and "steady-state" CPU.

### Gaps
- No current public data compares memory per in-flight request for undici, reqwest/hyper, Python `urllib3`, and Pyodide's fetch bridge. The rustls/OpenSSL per-session numbers date from Dec 2023, and BoringSSL per-connection memory was not found.
