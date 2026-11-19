# Isolation substrates, per-instance costs, and native interpreter baselines (as of 2026-11-13)

Scope: substrates that sandboxed scripting runtimes sit on (in-process Wasm engines, in-process micro-VMs, OS/VM isolation for native "Group A" interpreters), their per-instance memory and latency, and idle/startup baselines of native interpreters. Builds on, and does not repeat, an internal sandbox competitor comparison (not published) (2026-03-28).

**How to read the numbers.** "Measured (local)" rows come from benchmarks run for these notes on 2026-11-13. Host: Debian 13, kernel 6.12.116, AMD EPYC 7443P exposed as 48 vCPUs (1 thread/core), 56 GiB RAM, no swap, **shared with other running workloads**, so absolute latencies are noisy and likely pessimistic; relative ordering is the useful signal. Startup = median of 21 runs after 3 warm-ups, spawned from Python `subprocess` (`/bin/true` baseline = 0.98 ms). Idle memory = median of 3 samples after a 2 s settle while blocked on stdin/timer, read from `/proc/<pid>/smaps_rollup` and `/proc/<pid>/status`. **RssAnon / Private_Dirty = private memory (true marginal cost of one more process); RssFile = file-backed pages shareable across processes running the same binary; VmSize = virtual reservation, not memory.** Scripts and raw outputs: `isolation_substrates_bench/` next to this file ([results.json](isolation_substrates_bench/results.json), [Wasmtime output](isolation_substrates_bench/wtbench/output.txt), [Node/Pyodide output](isolation_substrates_bench/node-wasm-and-pyodide-output.txt)). Versions/dates of projects come from their GitHub releases on 2026-11-13. The session's WebSearch budget ran out midway, so several managed-service and VMM numbers are listed under Gaps instead of being guessed.

**Table 1. Inferred per-session isolation tax (built from the cited measurements below; tiny guest unless stated).** Fixed cost only; the guest runtime's own heap (for example Pyodide's ~20 MiB linear memory) comes on top.

| Substrate | Create latency | Fixed resident cost / session | Virtual reservation / session | Host-call cost | Basis |
|---|---|---|---|---|---|
| Wasmtime 50, pooling + CoW, Cranelift | ~6 µs | ~10 KiB (+ dirtied heap pages) | ~4.03 GiB slot, reserved up front | 7.5 ns sync; ~65-75 ns async (ready); ~0.55 µs per real suspension | measured (local) |
| Wasmtime 50, on-demand allocator | ~77 µs | ~10 KiB | ~4.06 GiB per memory (+2 MiB per async fiber) | same | measured (local) |
| V8 wasm in Node 24 (`new WebAssembly.Instance`) | ~55 µs | ~5 KiB | 8 GiB per wasm32 memory (Node 22: 10 GiB); hard cap ~16k memories/process | not measured | measured (local) |
| Pyodide 0.29.5 in Node 24, no snapshot | ~1.25 s | ~38-47 MiB private per extra instance (first: ~116 MiB) | ~16 GiB | n/a | measured (local) |
| Hyperlight micro-VM | 1-2 ms (vendor) | hyperlight-js: ≥5 MiB writable budget (docs); hluk: 3.3 MiB per idle sandbox with shared snapshot (measured, 3rd party) | n/a | "µs" (vendor) | vendor + 3rd party |
| Fork from warm CPython zygote | ~4 ms | ~1 MiB private (with `gc.freeze`), ~7 MiB after a full GC without it | n/a | IPC | measured (local) |
| Fresh process + namespaces (bwrap-style) + CPython 3.13 | ~13-16 ms interpreter (incl. ~1 ms spawn) + ~1-5 ms namespaces | ~2-3 MiB private idle (+~5-6 MiB shareable text) | ~17 MiB | IPC | measured (local) |
| Same, with Node 24 | ~45 ms + namespaces | ~8 MiB private idle (+~36 MiB shareable text) | ~1.3 GiB | IPC | measured (local) |
| gVisor (runsc) | ~0.5-0.6 s via container tooling | ~20-31 MiB per idle sandbox | n/a | syscalls ~5x slower than runc | measured (3rd party) |
| Firecracker | ≤125 ms to guest init; VMM up in ~12 ms typical | VMM ≤5 MiB + guest RAM actually touched | n/a | virtio/vsock | vendor spec |
| Kata Containers 4.3 | ~4.6 s (nested virt) | ~180 MiB per idle pod (nested) | n/a | n/a | measured (3rd party) |

**Table 2. In-process Wasm engines (host-embeddable).**

| Engine (latest, date) | Tiers | Instantiate | Per-instance memory | Host calls / async | Limits | Outbound HTTP |
|---|---|---|---|---|---|---|
| Wasmtime 50.0.1 (2026-10-29), Rust/C | Cranelift (T1), Winch baseline (T1), Pulley interpreter (T2) | 6.2 µs pooling / 77 µs on-demand (local) | ~10 KiB RSS; 4 GiB reservation + 32 MiB guards per memory by default | 7.5 ns wasm→host, 28.6 ns host→wasm (local); fibers (2 MiB VA default), CM async + WASI 0.3 default since v46 | epoch +14%, fuel +84% on a tight loop (local); docs say epoch ~10% | wasi-http (T1); WASI 0.3 `service`/`middleware` worlds |
| V8 (Node 22.23 / 24.18; Deno 2.5) | Liftoff + TurboFan | ~55-60 µs (local) | ~5 KiB RSS; 10 GiB (V8 12.4) / 8 GiB (V8 13.6) VA per memory | JSPI default in Node 25+, Chrome 137+, Deno 2.5; flag in Node 24 | VA cap: 13,060 (Node 22) / 16,320 (Node 24) live memories per process (local) | host `fetch` via imports |
| Wasmer 7.5.0 (2026-10-01) | Cranelift, LLVM 21, Singlepass | not measured | CLI process: 6.5 MiB private, 9.5 GiB VA, 52 threads (local) | v7: WASIX green threads, experimental async API | n/a | WASIX TCP/UDP sockets + DNS (guest's own client) |
| WasmEdge 0.18.1 (2026-10-22) | interpreter, LLVM AOT/JIT | n/a | n/a | n/a | call stack default 8 MiB interp / 512 KiB AOT-JIT | n/a |
| WAMR 2.4.5 (2026-06-29), C | classic/fast interp, AOT, Fast JIT, LLVM JIT, tier-up | n/a | interpreter binary ~56-59 KB | n/a | n/a | n/a |
| wasm3 0.9.0 (2026-08-24), C | interpreter | n/a | ≥~64 KB code, ~10 KB RAM | suspend/resume snapshots, gas metering | "minimal maintenance" | n/a |
| wazero 1.12.0 (2026-05-29), Go only | compiler + interpreter | n/a | n/a | non-blocking IO on custom files | n/a | n/a |
| wasmi 2.0.0 (2026-09-01), Rust | register interpreter, lazy translation | "on par" with 1.x (vendor) | module-shared bytecode (vendor) | fuel built in | ~2.2x faster than 1.0 (vendor) | n/a |

**Table 3. Plugin and micro-VM frameworks.**

| Framework (latest, date) | Substrate | Notable facts |
|---|---|---|
| Extism 1.41.0 (2026-10-09) | Rust runtime on Wasmtime 49 (WASI p1) | `http_request` host function, gated by manifest `allowed_hosts` |
| Hyperlight 0.19.0 (2026-11-04) | library VMM on KVM / MSHV / WHP, no guest kernel | 1-2 ms VM creation (vendor), target <1 ms; `snapshot()`/`restore()`; pre-1.0 |
| hyperlight-wasm 0.16.0 (2026-11-10) | Wasmtime 47.0.4 (or 36.0.14 LTS) inside the micro-VM | |
| hyperlight-js 0.5.0 (2026-11-05) | QuickJS inside Hyperlight; Node.js bindings | writable memory budget default and minimum 5 MiB; persistent snapshots across processes |
| hyperlight-unikraft / `hluk` 0.21.0 | Unikraft kernel in Hyperlight, runs Linux programs | warm restore ~30 ms, 3.3 MiB per idle sandbox (3rd-party measurement) |
| Spin 4.3.0 (2026-11-05) | Wasmtime 50.0.1, wasmtime-wasi with `p3` | |
| wasmCloud 2.12.1 (2026-11-08) | Wasmtime 48.0.8 | |
| Lunatic 0.13.2 (2023-05-03) | Wasmtime | dormant: last push 2025-03-29 |

**Table 4. Host-level isolation for native interpreters.**

| Mechanism (latest, date) | Start overhead | Memory per idle sandbox | Runtime overhead | Source type |
|---|---|---|---|---|
| user namespace (`unshare -Ur`) | 2.83 ms total vs 0.98 ms plain exec (includes one extra exec) | none beyond the process | none measured | measured (local) |
| + net namespace (`-Urn`) | 4.31 ms total | same | same | measured (local) |
| all namespaces + PID fork + `/proc` mount | 6.35 ms total | same | same | measured (local) |
| Anthropic `srt` 0.0.83 (2026-11-13) | bwrap + host proxies | proxy processes shared by sandboxes | proxy hop for all egress | docs |
| OpenAI Codex `codex-linux-sandbox` (rust-v0.169.0, 2026-11-13) | bwrap (system preferred, bundled fallback) + seccomp; legacy Landlock path retained | none beyond the process | none | docs |
| runc container | 0.61 s (`nerdctl run --rm`), 0.52 s (`docker run hello-world`, local) | 5.3 MiB (k3s pods) / 11.9 MiB (Docker) | baseline | measured |
| gVisor release-20261109.0 | 0.61 s (`nerdctl`), 0.48 s (Docker) | 30.9 MiB (k3s pods) / 19.9 MiB (Docker) | syscall loop 5.2x slower; nginx 8.9x fewer req/s (nested VM) | measured (3rd party) |
| Firecracker 1.18.0 (2026-11-09) | VMM: 8 CPU-ms, 6-60 ms wall (typ. 12 ms); ≤125 ms to guest `/sbin/init` | VMM ≤5 MiB (1 vCPU, 128 MiB guest) | >95% compute; +0.06 ms network latency | vendor spec |
| Kata 4.3.1 (2026-10-21), QEMU | 4.60 s (nested) | 179.9 MiB | nginx 21x fewer req/s (nested) | measured (3rd party) |
| Full VM (Ubuntu cloud image) | 29.1 s to SSH | 717.5 MiB | | measured (3rd party) |
| libkrun 1.19.8 (2026-11-06) / microsandbox 0.7.15 (2026-11-12) | <100 ms guest boot on M1 (vendor) | n/a | | vendor |
| Cloud Hypervisor 54.1, Unikraft 0.21.0 | not found ("milliseconds", vendor) | not found | | gap |

**Table 5. Native runtime baselines (hello world and idle).** Local columns measured here; right-hand columns from the hanabi1224 benchmark (AMD EPYC 7763, 4 cores, generated 2025-08-01; "peak mem" is max RSS including shared pages).

| Runtime | Local hello (ms, median) | Local idle RSS = private anon + shareable file (MiB) | Local VmSize | Threads | hanabi1224 time / peak MB (version) |
|---|---|---|---|---|---|
| CPython 3.13.5 (Debian) | 16.3 | 8.4 = 2.8 + 5.6 | 17 MiB | 1 | 13 ms / 8.8 (3.13.5) |
| CPython 3.13 `-I -S` | 12.6 | 7.6 = 2.1 + 5.4 | 17 MiB | 1 | |
| CPython 3.14.10 (Homebrew) | 20.3 | 9.5 = 3.1 + 6.4 | 16 MiB | 1 | |
| CPython 3.15.2 (Homebrew) | 20.3 | 10.1 = 3.2 + 6.8 | 16 MiB | 1 | |
| Node 22.23.1 | 45.9 | 41.7 = 6.3 + 35.4 | 0.7 GiB | 7 | |
| Node 24.18.0 | 46.8 | 44.0 = 7.9 + 36.1 | 1.3 GiB | 7 | 32 ms / 50.7 (24.4.1) |
| Deno 2.5.2 | 65.9 | 58.5 = 14.1 + 44.4 | 33.6 GiB | 19 | 26 ms / 45.5 (2.4.3) |
| Bun 1.3.14 | 36.2 | 32.6 = 7.2 + 25.3 | 70.4 GiB | 9 | 11 ms / 30.6 (1.2.19) |
| Perl 5.44 | 3.5 | 5.0 = 0.5 + 4.5 | 11 MiB | 1 | 2.4 ms / 5.1 (5.40.2) |
| Lua 5.5.1 | 1.45 | 2.1 = 0.1 + 2.0 | 4 MiB | 1 | 1.4 ms / 2.1 (5.4.7) |
| LuaJIT 2.1 (2026 build) | 1.58 | 2.3 = 0.2 + 2.1 | 4 MiB | 1 | 1.4 ms / 2.4 |
| bash 5.2 / dash / busybox sh | 2.3 / 1.5 / 1.4 | 3.4 / 1.7 / 1.9 (anon 0.1-0.3) | 3-7 MiB | 1 | |
| Go 1.27.4 static binary | 4.0 | 2.6 (1.3 anon + 1.3 binary on tmpfs) | 1.2 GiB | 5 | 1.5 ms / 3.4 (1.24.5) |
| Ruby 3.4.5 / YJIT | not installed | | | | 50 / 51 ms, 12.8 / 13.0 MB |
| PHP 8.2.29 | not installed | | | | 48 ms / 52.2 MB |
| PyPy 3.11 | not installed | | | | 29 ms / 52.2 MB |
| OpenJDK 21 / GraalVM JVM 17 | not installed | | | | 69 ms / 43.9 MB; 62 ms / 52.9 MB |
| .NET 9 / NativeAOT 9 | not installed | | | | 35 ms / 26.1 MB; 6.8 ms / 9.5 MB |
| TruffleRuby 24.2.2 | not installed | | | | 35 ms / 141.9 MB |

**Table 6. Managed AI sandbox services: new facts since 2026-03-28.**

| Service | New fact (per-sandbox numbers where found) |
|---|---|
| Daytona | Core development moved to a private codebase in June 2026; public repo archived (last release v0.190.0, 2026-06-23) |
| Vercel Sandbox | GA; Firecracker microVMs; Ubuntu-based default image (Node LTS, Python 3.14) or custom OCI images; persistence on by default; Active CPU billing: 1 vCPU / 2 GB idle ≈ $1.05/day vs busy ≈ $4.09/day (iad1) |
| Cloudflare | Sandbox SDK containers: "each instance is a microVM with its own kernel and network"; Dynamic Workers: load "in milliseconds", outbound intercept/block, Code Mode "up to 80%" token savings (vendor) |
| Modal Sandboxes | Runtime selectable: gVisor or VM (own kernel); GPU only with gVisor; default lifetime 5 min, max 24 h; filesystem snapshots |
| Deno Sandbox | Pre-release Linux microVMs on Deno Deploy; boots "under a second"; 768-4096 MB (1.2 GB default), 2 vCPU, 10 GB disk, ≤30 min; `allowNet`; secrets substituted only on egress; 5 concurrent per org by default |
| Blaxel | Resume <25 ms (vendor); standby after ~15 s idle; ~50% of memory reserved for tmpfs; 8 GB → 4 cores, 16 GB → 6 cores |
| Fly Sprites (launched Jan 2026) | Checkpoint ~300 ms, restore "well under a second", cold start <1 s (vendor); some third parties report ~9 s restores (unverified) |
| Freestyle | Smallest base snapshot (BusyBox): 1 vCPU, 128 MiB, 1 GB disk |
| microsandbox 0.7.15 | libkrun microVM per child process; <100 ms boot on M1 (vendor); live fork; `--cow-mem` restores share unchanged memory |

## Wasm runtimes for in-process embedding: per-instance memory, instantiation, host-call overhead, limits, async, HTTP

### Takeaway
Wasmtime 50 with the pooling allocator and copy-on-write memory images is the cheapest in-process substrate measured: about 6 µs to instantiate, about 10 KiB resident per live instance, 7.5 ns per synchronous host call, and about 11 KiB per guest suspended in a pending async host call. V8 in Node costs ~10x more to instantiate (~55 µs) and caps a process at ~13-16k live wasm memories because of 8-10 GiB virtual reservations each. Interpreters (Pulley) are ~30x slower on compute and ~30x slower per host call.

### Cited Findings
**Wasmtime (measured locally, Wasmtime 50.0.1, release build, single thread; tiny module with one 64 KiB memory and a data segment):**
- wasm→host synchronous call 7.46 ns; host→wasm `TypedFunc::call` 28.6 ns (Cranelift). With epoch interruption 8.67 / 29.4 ns; with fuel 8.31 / 20.2 ns; Winch 8.73 / 36.8 ns; Pulley interpreter 235 / 202 ns — [Local Wasmtime bench](isolation_substrates_bench/wtbench/output.txt)
- Compute loop (300M xorshift iterations): Cranelift 475 ms; +epoch 541 ms (1.14x); +fuel 876 ms (1.84x); Winch 791 ms (1.67x); Pulley 15,052 ms (31.7x) — [Local Wasmtime bench](isolation_substrates_bench/wtbench/output.txt)
- Instantiate + drop (including `Store::new`): pooling 6.23 µs (Cranelift), 7.58 µs (Pulley); on-demand 77.0 µs (Cranelift), 44.2 µs (Pulley) — [Local Wasmtime bench](isolation_substrates_bench/wtbench/output.txt)
- 10,000 live instances, each dirtying one 4 KiB page: 10.3 KiB RSS per instance (Cranelift, both allocators), 15.5 KiB (Pulley). Virtual: on-demand ≈ 4.06 GiB per instance; pooling reserved ≈ 39.8 TiB at engine creation for 10,100 slots (≈ 4.03 GiB/slot), then +6.3 KiB VmSize per instance — [Local Wasmtime bench](isolation_substrates_bench/wtbench/output.txt)
- Async (tokio current-thread): wasm→host call with an immediately ready future 64-74 ns; `call_async` entry ~257-259 ns; suspend + resume per pending host call 552-587 ns; 10,000 guests each suspended inside a pending async host call cost 10.6 KiB (pooling) to 11.6 KiB (on-demand) RSS per guest; on-demand adds ~2 MiB VA per guest for the fiber stack — [Local Wasmtime bench](isolation_substrates_bench/wtbench/output.txt)

**Wasmtime (docs and source):**
- v50 defaults: `memory_reservation` 4 GiB on 64-bit hosts (10 MiB on 32-bit), `memory_guard_size` 32 MiB, `max_wasm_stack` 512 KiB, `async_stack_size` 2 MiB; `Config::async_support` is deprecated and "no longer has any effect" — [wasmtime v50.0.1 config.rs](https://github.com/bytecodealliance/wasmtime/blob/v50.0.1/crates/wasmtime/src/config.rs)
- v50 default Cargo features include `async`, `pooling-allocator`, `component-model-async`, `stack-switching`, `threads`, `gc` — [wasmtime v50.0.1 Cargo.toml](https://github.com/bytecodealliance/wasmtime/blob/v50.0.1/crates/wasmtime/Cargo.toml)
- Pooling allocator preallocates resources for a configured maximum of concurrent instances; deallocation becomes a single `madvise`; CoW heap images defer copying until first write (`memory_init_cow`) — [Wasmtime fast instantiation docs](https://docs.wasmtime.dev/examples-fast-instantiation.html)
- Stability tiers: Cranelift Tier 1; Winch Tier 1 compiler (aarch64 targets Tier 2; Winch lacks threads, GC, function-references, wide-arithmetic on aarch64); Pulley Tier 2; component-model and component-model-async Tier 1; wasi-http, wasi-sockets Tier 1; memory64 and GC Tier 1; threads Tier 2; stack switching untiered (in progress on x86_64 Cranelift) — [Wasmtime stability tiers](https://docs.wasmtime.dev/stability-tiers.html)
- Epoch interruption "measured at around a 10% slowdown" and is faster than fuel; fuel is deterministic — [Wasmtime interrupting docs](https://docs.wasmtime.dev/examples-interrupting-wasm.html)
- (2022, possibly stale) SpiderMonkey.wasm instantiation went from ~2 ms to 5 µs with CoW plus lazy init; heap-init writes from tens of MB to a few KB; SpiderMonkey runs "roughly twice as fast" with epochs than with fuel — [Wasmtime 1.0 performance, 2022-09-06](https://bytecodealliance.org/articles/wasmtime-10-performance)
- Latest release v50.0.1 on 2026-10-29 — [Wasmtime releases](https://github.com/bytecodealliance/wasmtime/releases)

**WASI 0.3 / component-model async:**
- WASI 0.3.0 announced 2026-06-11; Wasmtime 46 ships it with Component Model Async on by default; `stream<T>`, `future<T>`, `async func` are canonical-ABI primitives; `wasi:io` removed; the host runs one event loop shared by all components; `wasi:http` reorganized into `service` and `middleware` worlds (middleware replaces `proxy`); jco supports all of 0.3, while Rust/Go/Python/JS/C#/C async bindings were still in progress at launch; 0.3.x patch releases every two months — [Bytecode Alliance: WASI 0.3](https://bytecodealliance.org/articles/WASI-0.3)
- 0.3.1 released 2026-08-11; Wasmtime 43-45 implemented the 0.3.0-rc-2026-03-15 snapshot behind `-Sp3 -W component-model-async=y` — [WASI.dev 0.3 release page](https://wasi.dev/releases/wasi-p3) (via search-result summary); blogs dating WASI 0.3 to Feb 2026 describe previews — [CODERCOPS](https://blog.codercops.com/blog/wasi-03-native-async-webassembly-server-2026)
- `wasmtime serve` runs 0.2 and 0.3 components from the same binary — [Component Model FAQ](https://component-model.bytecodealliance.org/reference/faq.html) (via search-result summary)

**V8 / Node WebAssembly (measured locally, tiny module, one 64 KiB memory, no declared max):**
- Node 22.23.1 (V8 12.4): 10 GiB VA per live instance's memory (trap-handler bounds checks); allocation fails at 13,060 live instances with "Out of memory: Cannot allocate Wasm memory for new instance" (total VmSize ≈ 127.5 TiB); RSS 4.7-5.2 KiB per instance; `new WebAssembly.Instance` 54-60 µs — [Local Node bench](isolation_substrates_bench/node-wasm-and-pyodide-output.txt)
- Node 24.18.0 (V8 13.6): 8 GiB VA per memory; fails at 16,320 live instances; RSS 4.8-5.8 KiB; 56-58 µs — [Local Node bench](isolation_substrates_bench/node-wasm-and-pyodide-output.txt)
- `--disable-wasm-trap-handler`: ~4 GiB VA per memory (module without a declared max), 46-49 µs instantiate (runtime cost of explicit bounds checks not measured) — [Local Node bench](isolation_substrates_bench/node-wasm-and-pyodide-output.txt)
- V8 reserves VA per instance, not per module; before Node 17.2 a ~1 TiB VA limit capped instances at ~100 — [nodejs/node#41319](https://github.com/nodejs/node/issues/41319) (via search-result summary); the reservation is address space, not committed memory, used to sandwich accesses between guard regions — [StackBlitz: Chasing memory bugs through V8 and WebAssembly](https://blog.stackblitz.com/posts/debugging-v8-webassembly/)
- JSPI defaults: Chrome 137 (flag 119-136), Firefox 153 (pref 150-152), Safari TP 238, Node 25 (flag `--experimental-wasm-jspi` in 24); JSPI copies the shadow stack to the heap on suspension; cannot combine with threads in wasm-bindgen — [wasm-bindgen JSPI guide](https://wasm-bindgen.github.io/wasm-bindgen/reference/jspi.html)
- Node commit "wasm: enable JSPI" (2025-09-23) was reverted on 2025-10-01 "as already enabled" by V8 — [nodejs/node 4396cf2d45](https://github.com/nodejs/node/commit/4396cf2d45), [nodejs/node 23b834058c](https://github.com/nodejs/node/commit/23b834058c)
- Local check: JSPI absent by default in Node 22.23.1 and 24.18.0 (present in 24 with the flag), present in Deno 2.5.2 (V8 14.0) and `WebAssembly.Suspending` exposed in Bun 1.3.14 (JavaScriptCore; behavior not tested) — [Local Node bench](isolation_substrates_bench/node-wasm-and-pyodide-output.txt)
- (2019, stale) Asyncify: binaries ~50% larger on average (1-2x range); 22% slowdown on fannkuch with Asyncify enabled but not sleeping; ~5x slowdown on SQLite; "no worse than double size / halve speed for most code" — [Zakai, Asyncify, 2019-07-16](https://kripken.github.io/blog/wasm/2019/07/16/asyncify.html)

**Other engines:**
- Wasmer 7.0: WASIX context switching API (green threads), experimental async API, full WASIX dynamic linking, LLVM 18→21, Singlepass RISC-V; LLVM compile of Python reduced ~90 s → ~10 s by skipping optimization of huge functions — [Wasmer v7.0.0 release](https://github.com/wasmerio/wasmer/releases/tag/v7.0.0); latest 7.5.0 on 2026-10-01 — [Wasmer releases](https://github.com/wasmerio/wasmer/releases)
- WASIX adds TCP/UDP sockets (IPv4/IPv6, DNS), pthreads, fork/exec/spawn, signals, non-blocking polling; only Wasmer is named as a runtime — [wasix.org](https://wasix.org/)
- Local: `wasmer run` of a cached WAT hello world took 54.6 ms; idle CLI process 57.2 MiB RSS = 6.5 MiB private + 50.7 MiB file-backed, 9.5 GiB VA, 52 threads (CLI overhead, not embedding cost) — [Local results.json](isolation_substrates_bench/results.json)
- WasmEdge 0.18.0 (2026-10-05): new `CallStackExhausted` trap at 8 MiB (interpreter) / 512 KiB (AOT/JIT) default call stack; AOT format bumped to v3; `wasmedge_process` plugin removed — [WasmEdge 0.18.0 release](https://github.com/WasmEdge/WasmEdge/releases/tag/0.18.0)
- WAMR: interpreter, AOT, Fast JIT, LLVM JIT with tier-up; ~58.9K (fast interpreter) and ~56.3K (classic interpreter) footprint; latest WAMR-2.4.5 on 2026-06-29 — [WAMR README](https://github.com/bytecodealliance/wasm-micro-runtime)
- wasm3: minimum ~64 KB code and ~10 KB RAM; gas metering, suspend/resume snapshots, resource caps; README still announces a "minimal maintenance phase", yet v0.9.0 (2026-08-24) added full validation and Wasm 2.0 conformance plus parts of 3.0 — [wasm3 README](https://github.com/wasm3/wasm3), [wasm3 v0.9.0](https://github.com/wasm3/wasm3/releases/tag/v0.9.0)
- wazero v1.12.0 (2026-05-29): extended const, exception handling, typed references, non-blocking IO on custom files — [wazero v1.12.0](https://github.com/tetratelabs/wazero/releases/tag/v1.12.0)
- wasmi 2.0 (2026-09-01): new interpreter core, ~2.2x faster than 1.0 by geomean on Apple M2 Pro; claims a place among the fastest portable interpreters vs wasm3, WAMR fast interpreter, Pulley, Stitch (chart values not in text); module-shared bytecode uses less memory than per-instance bytecode in wasm3/Stitch; startup "mostly on par" with 1.0 (vendor) — [Wasmi 2.0 article](https://wasmi-labs.github.io/blog/posts/wasmi-v2.0/); built-in fuel metering, compile-bomb-resistant translation — [wasmi README](https://github.com/wasmi-labs/wasmi)
- Wizard engine (research engine) has no tagged releases; last push 2026-11-09 — [titzer/wizard-engine](https://github.com/titzer/wizard-engine)

### Inferences
- Per-session fixed cost of an in-process Wasm sandbox is in the KiB range for both Wasmtime and V8; the guest's own dirtied heap dominates (for example Pyodide's 20 MiB linear memory). Benchmarks should report marginal RSS per guest runtime, not per engine.
- V8's 8-10 GiB-per-memory reservation, not RAM, is the first density limit in a single Node process (~16k concurrent wasm memories on Node 24). Pools of short-lived instances are fine; long-lived suspended sessions per process are capped. Wasmtime's on-demand allocator has the same class of limit (~32k at 4.06 GiB each, by arithmetic over 128 TiB of user VA), adjustable via `memory_reservation`.
- For "guest awaits many slow host calls", Wasmtime fibers cost ~11 KiB resident per suspended guest and ~0.55 µs per suspension, so 10k parallel in-flight host calls cost ~110 MiB. WASI 0.3 component-model async (default since Wasmtime 46) is the path to many concurrent calls inside one instance; JSPI is the V8 equivalent and is default only from Node 25.
- Epoch interruption is the right default CPU limit for benchmarks (~10-14% overhead); fuel nearly doubles tight-loop time.
- Pulley and pure interpreters are viable only for host-call-dominated "code mode" scripts; their ~200 ns host calls are still far below any network round trip.
- Outbound HTTP splits cleanly for the benchmark's two HTTP modes: host-provided engines (wasi-http implemented by the embedder, Extism's allowlisted `http_request`, or a JS `fetch` passed in as an import and awaited through JSPI) versus a guest-owned client over raw sockets (WASIX TCP/UDP in Wasmer, or wasi-sockets). Only the second exercises the guest runtime's own HTTP/TLS stack inside the sandbox.

### Gaps
- No direct measurement of Wasmer, WasmEdge, WAMR, wasm3, wazero or wasmi embedding (instantiate, host-call ns, per-instance memory); only vendor statements. The WebSearch budget ran out before third-party benchmarks could be found.
- Wasmer 6/7 multi-backend support (V8, WAMR, wasmi backends) not confirmed this session.
- Per-instance cost of a realistic guest (QuickJS, StarlingMonkey or CPython compiled to Wasm) in Wasmtime with CoW was not measured; only the tiny-module floor.
- Overhead of `--disable-wasm-trap-handler` explicit bounds checks in V8 and JSPI suspend/resume cost were not measured.
- WasmEdge async host functions and wasmi resumable calls were not verified.

## Snapshotting and pre-initialization: how CoW page sharing changes marginal RSS

### Takeaway
Snapshots convert startup CPU into shared, read-mostly pages: Wasmtime CoW images and fork servers leave only written pages private (~1 MiB for a forked CPython child with `gc.freeze`, versus ~14 MiB for a fresh one), and micro-VM snapshot restores reach tens of ms. Pyodide-style linear-memory snapshots fix cold start (~10 s → ~1 s) but, as far as the sources show, do not share pages between instances.

### Cited Findings
- Python fork server (local, CPython 3.13.5, parent with asyncio/ssl/urllib/http.client/json imported, 13.6 MiB private anon): fork + `_exit` + wait 4.07 ms median; child after small work has 0.9 MiB Private_Dirty (12.7 MiB still Shared_Dirty with the parent); after `gc.collect()` in the child 6.8 MiB Private_Dirty (GC touches object headers); with `gc.freeze()` in the parent before forking, 1.1 MiB — [Local results.json](isolation_substrates_bench/results.json). Note `RssAnon` stays 13.6 MiB in the child because it counts shared CoW pages; use Private_Dirty or PSS for marginal cost.
- Pyodide 0.29.5 in Node 24.18.0 without snapshots (local): `loadPyodide()` 1,471 ms first, 1,233-1,277 ms for later instances in the same process; linear memory 20 MiB after load; marginal RSS +116.5 MiB for the first instance, +38-47 MiB (all anonymous) for each later one; +16 GiB VA per instance — [Local Node/Pyodide bench](isolation_substrates_bench/node-wasm-and-pyodide-output.txt)
- Cloudflare Python Workers: importing fastapi, httpx and pydantic takes ~10 s without a snapshot and ~1 s with one; mean cold start 1.027 s vs AWS Lambda (no SnapStart) 2.502 s and Cloud Run 3.069 s; only Wasm linear memory is snapshotted, dynamic libraries are reloaded in the same order with a patched allocator, JS references are replayed by property path, and the PRNG is poison-seeded at deploy and reseeded after restore (published 2025-12-08, modified 2026-07-15) — [Cloudflare: Python Workers redux](https://blog.cloudflare.com/python-workers-advancements/); Python Workers reached GA in Sept 2026 — [InfoQ](https://infoq.com/news/2026/09/cloudflare-python-workers-ga)
- Wasmtime CoW images: see Wasmtime section (2 ms → 5 µs instantiation for SpiderMonkey.wasm in 2022; 6.2 µs measured locally).
- weval partially evaluates interpreters; for SpiderMonkey it gives "3-5x speedups over the generic interpreter"; latest v0.5.1 on 2026-10-12 — [weval README](https://github.com/bytecodealliance/weval)
- Wizer (Wasm pre-initializer) latest v11.0.3 on 2026-03-10 — [Wizer releases](https://github.com/bytecodealliance/wizer/releases)
- Firecracker snapshot restore maps the guest memory file with `MAP_PRIVATE` and loads pages lazily instead of reading the whole file at resume; diff snapshots are in developer preview; cgroups v1 causes high restore latency — [Firecracker snapshot-support.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)
- hyperlight-unikraft (`hluk` 0.21.0; i7-1165G7, 4 vCPU nested KVM, measured Nov 2026): cold boot 332.5 ms; cold restore from a disk snapshot 66.7 ms total (4.1 ms restore); warm restore from memory ~30 ms total (2.3 ms restore); a two-line Python script ends to end in 81.5 ms warm vs 14.7 ms native; numpy/pandas/scikit-learn template 204 ms warm vs 467.6 ms native Python; one idle process is 19.5 MiB RSS of which 11.9 MiB is the shared snapshot blob, 4.9 MiB the binary and 2.2 MiB private anon; with 10 running, PSS 3.9 MiB each and 3.3 MiB per sandbox by MemAvailable drop — [ComputingForGeeks: Hyperlight on Ubuntu](https://computingforgeeks.com/hyperlight-linux-micro-vms-ubuntu/)
- microsandbox restores can add `--cow-mem` to share unchanged memory from a full snapshot; live sandboxes can be forked — [microsandbox README](https://github.com/microsandbox/microsandbox)
- Fly Sprites: checkpoints take ~300 ms and restores reconnect "well under a second" (vendor) — [Fly Sprites checkpoint & restore](https://fly.io/sprites/checkpoint-restore/) (via search-result summary); two later write-ups cite ~9 s restores, unverified — [pr0xy.dev](https://pr0xy.dev/posts/2026-07-06-fly-sprites-make-agent-sandboxes-stateful), [boxd](https://boxd.sh/blog/boxd-vs-sprites/)
- hyperlight-js supports persistent snapshots across processes — [hyperlight-js README](https://github.com/hyperlight-dev/hyperlight-js)

### Inferences
- Marginal RSS after a snapshot equals pages the session writes. CoW sharing works when the snapshot is mapped (Wasmtime memfd images, `MAP_PRIVATE` VM memory files, `fork`); restoring by copying bytes (a Pyodide snapshot into a fresh V8 `WebAssembly.Memory`) makes every page private, because V8 offers no file-backed mapping into wasm memory. A Pyodide session therefore likely stays at ~40 MiB private even with snapshots; only the startup time drops.
- For CPython zygotes, call `gc.freeze()` before forking; otherwise the first collection in each child privatizes most of the inherited heap (0.9 → 6.8 MiB in the local test).
- A snapshot can beat native startup when imports dominate (hluk: 204 ms snapshot vs 468 ms native for numpy/pandas/sklearn), which favors snapshotting Group A runtimes with heavy data-science imports.

### Gaps
- No numbers fetched for V8 startup snapshots (`node --build-snapshot`), CRIU restore latency, or Firecracker snapshot restore latency on current hardware.
- Pyodide's own memory-snapshot API (and whether it is stable in 0.29) was not checked; Pyodide restore latency in Node was not measured.
- Whether Wizer's functionality has moved into the Wasmtime CLI was not verified.

## Plugin and sandbox frameworks: Extism, Hyperlight family, Lunatic, Spin, wasmCloud

### Takeaway
Extism, Spin and wasmCloud are layers over Wasmtime 48-50 and inherit its costs; Extism's distinctive piece is a host-mediated `http_request` with an allowlist. Hyperlight adds hardware isolation inside the host process at a vendor-claimed 1-2 ms per micro-VM and a ≥5 MiB budget for its QuickJS sandbox; Lunatic is dormant.

### Cited Findings
- Extism runtime depends on Wasmtime 49 with `wasmtime-wasi` p1; its `http_request` host function checks the manifest's `allowed_hosts` — [extism runtime Cargo.toml](https://github.com/extism/extism/blob/main/runtime/Cargo.toml), [extism runtime pdk.rs](https://github.com/extism/extism/blob/main/runtime/src/pdk.rs); latest v1.41.0 on 2026-10-09 — [Extism releases](https://github.com/extism/extism/releases)
- Hyperlight: library VMM, "micro VMs that spin up in milliseconds, with guest function calls completing in microseconds", no guest kernel, `snapshot()`/`restore()`, KVM/MSHV/WHP backends, pre-1.0 API; related `hyperlight-sandbox` offers a multi-backend framework with Python, .NET and Rust SDKs — [Hyperlight README](https://github.com/hyperlight-dev/hyperlight); v0.19.0 on 2026-11-04 — [releases](https://github.com/hyperlight-dev/hyperlight/releases)
- Microsoft (2024-11-07, vendor, no methodology): Hyperlight micro-VM spawn 1-2 ms vs <0.03 ms for a Wasmtime sandbox and >120 ms for an optimized traditional VM — [Introducing Hyperlight](https://opensource.microsoft.com/blog/2024/11/07/introducing-hyperlight-virtual-machine-based-security-for-functions-at-scale/); Hyperlight Wasm (2025-03-26): VM creation 1-2 ms "today", work toward <1 ms; a warm pool has a much smaller footprint than a traditional VM pool — [Hyperlight Wasm blog](https://opensource.microsoft.com/blog/2025/03/26/hyperlight-wasm-fast-secure-and-os-free/) (via search-result summary)
- hyperlight.org (vendor): "1-2 orders of magnitude faster than Firecracker"; concedes Wasmtime's pre-compiled instantiation is sub-millisecond — [hyperlight.org](https://hyperlight.org/)
- hyperlight-wasm runs Wasmtime 47.0.4 (optionally 36.0.14 LTS) inside the guest with `custom-virtual-memory` and `custom-native-signals` features; v0.16.0 on 2026-11-10 — [hyperlight-wasm source](https://github.com/hyperlight-dev/hyperlight-wasm)
- hyperlight-js runs JavaScript with QuickJS inside Hyperlight, ships Node.js bindings with host functions, and sets a writable-memory budget (guest heap, stack, transport pools, page tables, CoW pages) whose default and minimum is 5 MiB; v0.5.0 on 2026-11-05 — [hyperlight-js README](https://github.com/hyperlight-dev/hyperlight-js)
- Spin 4.3.0 (2026-11-05) depends on Wasmtime 50.0.1 and `wasmtime-wasi` with `p3` — [Spin Cargo.toml](https://github.com/spinframework/spin/blob/main/Cargo.toml); wasmCloud 2.12.1 (2026-11-08) depends on Wasmtime 48.0.8 — [wasmCloud Cargo.toml](https://github.com/wasmCloud/wasmCloud/blob/main/Cargo.toml)
- Lunatic's last release is v0.13.2 (2023-05-03) and last push 2025-03-29 — [lunatic releases](https://github.com/lunatic-solutions/lunatic/releases)

### Inferences
- For a Rust host, Extism adds a manifest/allowlist and memory-passing convention on top of Wasmtime; it does not lower per-instance cost below raw Wasmtime. For Node hosts, hyperlight-js is the only framework here that pairs a JS engine with hardware isolation inside the host process, at ≥5 MiB per sandbox plus VM exits per host call.
- Hyperlight's 1-2 ms creation is ~160-320x the measured Wasmtime pooling instantiate (6.2 µs); with snapshot/restore it fits session reuse better than per-call creation.

### Gaps
- No independent measurement of Hyperlight host-call latency, hyperlight-js startup, or per-VM memory for hyperlight-wasm.
- Extism per-plugin overhead and its JS SDK's engine were not measured.

## Host-level isolation for Group A: namespaces/seccomp/Landlock, gVisor, Firecracker, Cloud Hypervisor, libkrun, Kata, Unikraft

### Takeaway
Process sandboxes (bubblewrap-style namespaces + seccomp) add only ~1-5 ms and no resident memory beyond the interpreter, which makes interpreter startup (13-65 ms) and idle RSS the real Group A tax. gVisor adds ~20-31 MiB per sandbox and ~5x syscall cost; Firecracker adds ≤5 MiB VMM plus guest memory and ≤125 ms boot; Kata on QEMU costs ~180 MiB per pod.

### Cited Findings
- Local namespace setup (util-linux `unshare`, total including one extra exec): user ns 2.83 ms, user + net 4.31 ms, user + mount + net + IPC + PID + UTS with fork and `/proc` mount 6.35 ms, vs 0.98 ms to exec `/bin/true`; `docker run --rm --network=none hello-world` (Docker 29.9.3, runc) 521 ms median — [Local results.json](isolation_substrates_bench/results.json)
- Anthropic sandbox-runtime (`srt`, v0.0.83, 2026-11-13; research preview): Linux uses bubblewrap and removes the network namespace entirely; all traffic goes through host HTTP and SOCKS5 proxies reached over bind-mounted Unix sockets with domain allow/deny lists; macOS uses `sandbox-exec`; Windows uses a WFP filter for an `srt-sandbox` account; a standalone `srt proxy` mode exists; Unix sockets are blocked by default, on Linux via seccomp (x64/arm64 only; path allowlists are ignored because seccomp cannot filter by path; without seccomp sockets are unrestricted with a warning); `socat` relays proxy traffic and ripgrep scans deny paths — [srt README](https://github.com/anthropic-experimental/sandbox-runtime)
- Codex `codex-linux-sandbox`: bubblewrap is the default filesystem/namespace sandbox, preferring a system `bwrap` on PATH and falling back to a bundled one; seccomp with `PR_SET_NO_NEW_PRIVS` filters syscalls; legacy Landlock code is retained; WSL1 unsupported; restricted network uses `--unshare-net`, and managed proxy mode adds a TCP→UDS→TCP bridge so tool traffic reaches only the configured proxy, after which seccomp allows IP sockets inside the namespace but blocks new standalone `AF_UNIX` sockets; `AF_VSOCK` is blocked even with unrestricted networking — [codex-rs/linux-sandbox README](https://github.com/openai/codex/blob/main/codex-rs/linux-sandbox/README.md); preferring system bwrap followed an Ubuntu/AppArmor regression after switching to the vendored build in 0.115.0 — [mirror of codex-rs linux-sandbox history](https://forge.lthn.ai/core/core-agent-ide/src/branch/dev/codex-rs/linux-sandbox/README.md) (secondary, via search-result summary); layered design overview — [Codex sandbox internals (2026-05-03)](https://codex.danielvaughan.com/2026/05/03/codex-cli-sandbox-internals-seatbelt-bubblewrap-landlock-windows-dacl/)
- Latest versions: bubblewrap v0.13.1 (2026-10-14), nsjail 3.6 (2026-03-18) — [bubblewrap releases](https://github.com/containers/bubblewrap/releases), [nsjail releases](https://github.com/google/nsjail/releases)
- runc vs gVisor vs Kata vs VM (Oct 2026; i7-6700 Proxmox VM, 4 vCPU/12 GiB; Ubuntu 26.04.1, kernel 7.0; runc 1.5.2, gVisor release-20261026.0, Kata 4.3.1 with QEMU, k3s 1.37; Kata and VM nested): cold start `nerdctl run --rm` 0.61 / 0.61 / 4.60 s and 29.1 s to SSH; pod-to-Ready 0.84 / 0.95 / 4.76 s; host memory per idle sandbox 5.3 / 30.9 / 179.9 / 717.5 MiB; 1M × `dd bs=1` 2.31 / 12.06 / 0.68 / 3.17 s; nginx 41,762 / 4,700 / 1,966 / 23,786 req/s; p99 2.70 / 34.02 / 63.14 / 9.60 ms — [ComputingForGeeks: gVisor vs Kata vs runc (2026-11-10)](https://computingforgeeks.com/gvisor-vs-kata-containers-vs-runc/). A search summary of the same article attributes ~12 MiB of gVisor's per-pod cost to the Sentry (not re-verified).
- A second setup (Docker 29.1.3, runsc release-20261102.0, nested KVM): host memory per idle sandbox runc 11.9 MiB, gVisor 19.9 MiB; Python start 484 ms (runc) and 481 ms (gVisor) through Docker — [ComputingForGeeks: Hyperlight on Ubuntu](https://computingforgeeks.com/hyperlight-linux-micro-vms-ubuntu/)
- gVisor Systrap (2023-04-28, possibly stale) replaced ptrace as default: seccomp traps into a signal handler that talks to the Sentry over shared memory, and on x86_64 the `syscall` instruction is patched into a jump to a trampoline; results only in charts — [gVisor Systrap blog](https://gvisor.dev/blog/2023/04/28/systrap-release/); gVisor adds no cost to raw memory access — [gVisor performance guide](https://gvisor.dev/docs/architecture_guide/performance/)
- Firecracker spec: VMM starts to API socket within 8 CPU-ms (wall 6-60 ms, typically 12 ms); VMM threads ≤5 MiB overhead for a 1 vCPU/128 MiB guest; ≤125 ms from InstanceStart to guest `/sbin/init`; guest compute >95% of bare metal; network up to 14.5 Gbps at ≤80% of a core, +0.06 ms latency; storage up to 1 GiB/s — [Firecracker SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md); latest v1.18.0 on 2026-11-09 — [releases](https://github.com/firecracker-microvm/firecracker/releases)
- libkrun: a dynamic library that gives a program a KVM (Linux), HVF (macOS/ARM64) or WHP (Windows, upcoming) microVM; `main` is now libkrun 2.0 (not backward compatible); SEV and TDX variants; consumers include crun (`--runtime=krun`) and krunkit; warns that the VM boundary does not restrict host resources exposed through devices — [libkrun README](https://github.com/containers/libkrun); microsandbox builds on libkrun and smoltcp, boots each microVM as a child process, and claims <100 ms guest boot measured on an M1 (vendor) — [microsandbox README](https://github.com/microsandbox/microsandbox)
- Unikraft README claims boots "in milliseconds" (vendor); latest RELEASE-0.21.0 on 2026-05-20 — [Unikraft](https://github.com/unikraft/unikraft)
- Kata 4.3.1 released 2026-10-21; Cloud Hypervisor v54.1 on 2026-11-11; gVisor release-20261109.0 — [Kata releases](https://github.com/kata-containers/kata-containers/releases), [Cloud Hypervisor releases](https://github.com/cloud-hypervisor/cloud-hypervisor/releases), [gVisor releases](https://github.com/google/gvisor/releases)

### Inferences
- For per-session Group A sandboxes, a bwrap/nsjail-style process is the cheapest boundary: namespace setup is ~1-5 ms and adds no daemon; seccomp and Landlock add near-zero steady-state cost. A pre-forked, pre-namespaced zygote can remove both namespace and interpreter startup from the request path.
- gVisor's per-sandbox memory (~20-31 MiB) exceeds CPython's private idle footprint (~3 MiB) by roughly 10x, and its syscall cost matters for I/O-heavy agent scripts (HTTP clients, file processing).
- Firecracker-class microVMs pay guest-kernel memory on top of the ≤5 MiB VMM; density depends on snapshot restore with shared page cache, not on boot.
- The two third-party measurements disagree on runc and gVisor memory (5.3 vs 11.9 MiB; 30.9 vs 19.9 MiB) because of different stacks (k3s/containerd vs Docker) and methods (process RSS vs MemAvailable). The benchmark should measure its own stack with one method.

### Gaps
- No numbers fetched for Cloud Hypervisor boot time or memory, Unikraft (EuroSys 2021) boot and memory, minijail, firejail, or Kata on bare metal.
- No direct measurement of bubblewrap or nsjail themselves (not installed); the `unshare` timings are a proxy.
- Firecracker NSDI 2020 density figures (microVMs per second per host) were not re-fetched.

## Baseline footprints of native runtimes and fork-server/zygote amortization

### Takeaway
Shells, Lua, LuaJIT and Perl start in 1.4-3.5 ms with ≤0.5 MiB private memory; CPython starts in 13-20 ms with ~2-3 MiB private; JS runtimes start in 11-66 ms (Bun fastest, Deno slowest) with 6-14 MiB private plus 25-45 MiB of shareable binary text and large VA reservations; JVM and PHP-CLI sit at ~50-70 ms and ~44-52 MB peak. A warm fork server cuts CPython to ~4 ms and ~1 MiB private per child.

### Cited Findings
- Local medians (conditions in the header): CPython 3.13.5 16.3 ms (12.6 ms with `-I -S`), 3.14.10 and 3.15.2 (Homebrew builds) 20.3 ms; Node 22.23.1 45.9 ms; Node 24.18.0 46.8 ms; Deno 2.5.2 65.9 ms (`deno eval`); Bun 1.3.14 36.2 ms (`bun -e`); Perl 5.44 3.5 ms; Lua 5.5.1 1.45 ms; LuaJIT 2.1 1.58 ms; bash 2.3 ms; dash 1.5 ms; busybox sh 1.4 ms; static Go 1.27.4 binary 4.0 ms — [Local results.json](isolation_substrates_bench/results.json)
- Local idle memory (private anon + file-backed): CPython 3.13 2.8 + 5.6 MiB; Node 22 6.3 + 35.4 MiB (VA 0.7 GiB, 7 threads); Node 24 7.9 + 36.1 MiB (VA 1.3 GiB); Deno 14.1 + 44.4 MiB (VA 33.6 GiB, 19 threads); Bun 7.2 + 25.3 MiB (VA 70.4 GiB, 9 threads); Perl 0.5 + 4.5 MiB; Lua 0.1 + 2.0 MiB; LuaJIT 0.2 + 2.1 MiB; bash 0.3 + 3.1 MiB; dash and busybox 0.1 + ~1.6-1.8 MiB — [Local results.json](isolation_substrates_bench/results.json)
- hanabi1224 helloworld (generated 2025-08-01, AMD EPYC 7763, 4 cores; time / peak memory): Ruby 3.4.5 50 ms / 12.8 MB (YJIT 51 ms / 13.0 MB); TruffleRuby 24.2.2 35 ms / 141.9 MB; PHP 8.2.29 48 ms / 52.2 MB; OpenJDK 21 69 ms / 43.9 MB; OpenJDK 23 73 ms / 44.7 MB; OpenJDK 21 + ZGC 186 ms / 42.9 MB; GraalVM JVM 17 62 ms / 52.9 MB; .NET 9 35 ms / 26.1 MB; .NET NativeAOT 9 6.8 ms / 9.5 MB; Mono 6.12 30 ms / 21.3 MB; CPython 3.13.5 13 ms / 8.8 MB; PyPy 3.11 29 ms / 52.2 MB; Node 24.4.1 32 ms / 50.7 MB; Deno 2.4.3 26 ms / 45.5 MB; Bun 1.2.19 11 ms / 30.6 MB; Lua 5.4.7 1.4 ms / 2.1 MB; LuaJIT 1.4 ms / 2.4 MB; Perl 5.40.2 2.4 ms / 5.1 MB; Go 1.24.5 1.5 ms / 3.4 MB; TinyGo 0.8 ms / 0.3 MB; Kotlin/Native 2.2 ms / 3.0 MB; Dart AOT 3.5 ms / 5.3 MB — [Programming Language Benchmarks: helloworld](https://programming-language-benchmarks.vercel.app/problem/helloworld)
- (2017-2018 data, stale) bdrung/startup-time on an Intel i5-2400S: Ruby 2.3 32.4 ms, PHP 7.1/7.2 8.7 ms, PyPy 5.8 27.5 ms, Java 8 54.6 ms, Python 3.6 25.8 ms (9.3 ms with `-S`); repo last updated 2020-11 — [bdrung/startup-time](https://github.com/bdrung/startup-time)
- Python fork-server numbers (4.07 ms fork; 0.9-1.1 MiB private per child with `gc.freeze`; 6.8 MiB without after a GC) — see Snapshotting section and [Local results.json](isolation_substrates_bench/results.json)
- Native Python script in 14.7 ms vs 81.5 ms in a warm hluk micro-VM (third-party, nested KVM) — [ComputingForGeeks: Hyperlight on Ubuntu](https://computingforgeeks.com/hyperlight-linux-micro-vms-ubuntu/)

### Inferences
- The local JS-runtime startup times are ~1.4-3x slower than hanabi1224's (for example Bun 36 vs 11 ms), consistent with a loaded, older host and the `-e`/`eval` code paths; Lua, Perl and Go agree closely. Use relative ordering from local data and absolute values only from a quiet benchmark host.
- For marginal memory per Group A session, count private anon (CPython ~2-3 MiB, Node ~6-8 MiB, Deno ~14 MiB, Lua/Perl/shells <1 MiB) plus whatever the script allocates; file-backed text is shared across sessions running the same binary.
- Deno and Bun reserve 34-70 GiB of VA at idle; fine on 64-bit Linux, but sandbox rlimits such as `RLIMIT_AS` or cgroup settings that count VA would break them, as they would V8 wasm memories.
- Zygotes amortize the 13-65 ms interpreter starts: CPython (`os.fork`, `multiprocessing` forkserver) is straightforward; Node/Deno/Bun have no supported fork, so they need V8 snapshots or warm pools instead.
- Homebrew-built CPython 3.14/3.15 starting ~25% slower than Debian's 3.13 may reflect build flags rather than the version; compare versions from one build source.

### Gaps
- GraalVM native-image, Julia, R, Ruby, PHP and PyPy were not available locally; hanabi1224 has no native-image, Julia or R entries, so their current startup and idle RSS remain unsourced.
- Kernel-side per-process costs (page tables, task structs) were not measured separately.

## Managed AI sandbox services: new facts and per-sandbox numbers

### Takeaway
Since March 2026 the managed field has converged on microVMs with snapshots and egress mediation: Vercel Sandbox is GA with persistence by default, Cloudflare's Sandbox SDK containers are microVMs, Modal offers a VM runtime alongside gVisor, Deno Sandbox and Fly Sprites launched, and Daytona closed its source. Published per-sandbox numbers remain mostly vendor claims.

### Cited Findings
- Daytona: "As of June 2026, Daytona's core development has moved to a private codebase"; the public repository is archived (last release v0.190.0, 2026-06-23) — [daytonaio/daytona](https://github.com/daytonaio/daytona)
- Vercel Sandbox (docs updated 2026-09-22): generally available; each sandbox is a Firecracker microVM; default image `vercel/sandbox/universal` with current Node LTS and Python 3.14, or custom OCI images from Vercel Container Registry; persistence is the default; system-privileged processes (Docker, VPN, FUSE) allowed; Active CPU billing example in iad1 for 1 vCPU / 2 GB: idle (1% CPU) $1.05/day, busy $4.09/day; Drives in private beta — [Vercel Sandbox docs](https://vercel.com/docs/vercel-sandbox)
- Cloudflare (docs updated 2026-10-31): Dynamic Workers load "in milliseconds", can intercept or block outbound requests, run JavaScript, Python or WebAssembly, and power Code Mode ("Save up to 80% in inference tokens and cost", vendor); Durable Object Facets give dynamically loaded code its own SQLite — [Cloudflare Dynamic Workers docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/); Sandbox SDK requires Workers Paid and its containers are microVMs: "Each instance is a microVM with its own kernel and network" — [Cloudflare Sandbox SDK docs](https://developers.cloudflare.com/sandbox/)
- Modal Sandboxes: choose `gVisor` or `VM` runtime (VM gives each sandbox its own kernel); GPUs only with gVisor; default max lifetime 5 min, configurable to 24 h; filesystem snapshots; billed at max(request, actual) — [Modal sandbox guide](https://modal.com/docs/guide/sandbox)
- Deno Sandbox (pre-release, docs updated 2026-03-19): Linux microVMs orchestrated by Deno Deploy; "Each sandbox boots in under a second"; 768-4096 MB memory (1.2 GB default), 2 vCPU, 10 GB ephemeral disk, lifetime up to 30 min; `allowNet` egress allowlist; secrets never enter the sandbox and are substituted only on requests to approved hosts; regions ams and ord; 5 concurrent sandboxes per org by default; runs Deno, Node 24+, Python 3.10+ — [Deno Sandbox docs](https://docs.deno.com/sandbox/)
- Blaxel: resume from standby in under 25 ms (vendor); standby after ~15 s of inactivity (15 min with an open connection); ~50% of memory reserved for the tmpfs writable layer; 8 GB → 4 cores, 16 GB → 6 cores; archived mode drops memory state; creation timeout 1-50 s — [Blaxel sandbox docs](https://docs.blaxel.ai/Sandboxes/Overview)
- Fly Sprites launched in January 2026 as persistent VMs for agents — [Simon Willison, 2026-01-09](https://simonwillison.net/2026/Jan/9/sprites-dev/); checkpoint ~300 ms, restore "well under a second", cold start typically <1 s (vendor) — [Fly Sprites checkpoint & restore](https://fly.io/sprites/checkpoint-restore/) (via search-result summary)
- Freestyle base snapshots: BusyBox 1 vCPU / 128 MiB / 1 GB disk; Kali 4 vCPU / 8 GiB / 32 GB — [Freestyle llms.txt](https://www.freestyle.sh/docs/llms.txt)
- microsandbox 0.7.15 (2026-11-12): libkrun microVMs, <100 ms boot on M1 (vendor), live fork, snapshots with `--cow-mem` — [microsandbox README](https://github.com/microsandbox/microsandbox)
- E2B: JS/Python SDK 2.63.0 (2026-11-04), infra release 2026.30 (2026-09-10); no new resource or latency numbers found — [E2B releases](https://github.com/e2b-dev/E2B/releases), [E2B infra releases](https://github.com/e2b-dev/infra/releases)

### Inferences
- Credential brokering at the egress proxy (Vercel earlier, now Deno Sandbox) and egress allowlists are becoming standard. An in-process benchmark harness that routes guest HTTP through a host-provided engine can mirror this design.
- Managed services do not publish marginal memory per sandbox; only Freestyle's 128 MiB minimum and Deno's 768 MB minimum bound the smallest allocations, both orders of magnitude above in-process Wasm sessions.

### Gaps
- The WebSearch budget ran out, so no current numbers were collected for E2B (beyond prior research), Modal sandbox startup latency, Cloudflare Dynamic Workers pricing and limits, Cloudflare container instance sizes, Freestyle VM start and fork times, or Fly Sprites hardware.
