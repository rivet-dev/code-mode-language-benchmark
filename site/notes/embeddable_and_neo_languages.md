# Embeddable scripting, data/query/config/template, array, neo, and agent-designed languages for running untrusted agent code (as of 2026-11-13)

## Overview: compact comparison, classification of every runtime, and benchmark shortlist

### Takeaway
Luau is the strongest in-process (Group B) candidate. It has a purpose-built sandbox that Roblox runs against "actively malicious" code, a guaranteed-eventual interrupt hook, host-controlled memory limits, coroutine-based async through mlua in Rust, and the best interpreter speed of the sandboxable options in the October 2026 Rust embedding benchmark. PUC Lua 5.5 with a stripped standard library is the smallest option, measured for this report at about 5 KB of heap for a bare state and about 16 KB of RSS per live state, with working allocator caps and instruction hooks. Among Rust-native languages, Rhai is the most hardened but the slowest and has no async; Rune has native async plus budgets but a smaller user base. For data work, CEL and minijinja are bounded by design, jaq is fast but has no limits, and JSONata had arbitrary-code-execution CVEs in 2026, so it is safe only inside an isolate. Languages designed for LLM agents are mostly orchestration DSLs rather than sandboxes; CaMeL, Monty (Python), and Risor v3 are the security-focused designs.

### Cited Findings

#### Compact comparison table (most promising runtimes for code mode)
"Unknown" means not found in this pass; see per-section Gaps. Speed is the October 2026 script-bench-rs "Sort Rust objects" result (lower is better; macOS 27.0 on an Apple M5 Max; host-call-heavy workload, details in the Rust section) unless noted.

| Runtime | Group | Rust host | Node host | CPU limit | Memory limit | Guest awaits host async without blocking a thread? | Empty-context footprint | Speed | Latest (date) | Sources |
|---|---|---|---|---|---|---|---|---|---|---|
| Luau | B | mlua (`luau`, `luau-jit`) | luau-web (3rd-party binding; build type unverified) | interrupt callback, called "eventually" | host allocator; mlua `set_memory_limit` | yes: mlua async fns over coroutines; interrupt can yield | unknown (not measured) | 11.82 ms | 0.746 (2026-11-07) | [sandbox](https://luau.org/sandbox), [mlua docs](https://docs.rs/mlua/latest/mlua/struct.Lua.html), [bench](https://github.com/khvzak/script-bench-rs), [releases](https://github.com/luau-lang/luau/releases) |
| PUC Lua 5.5.1, stripped stdlib | B | mlua (`lua55`) | wasmoon (Lua 5.4, stale), Fengari (5.3, pure JS) | count hook (measured) | allocator cap (measured) | yes: coroutines (mlua `async`) | 5.0 KB bare heap; ~16 KB RSS per state (measured) | 15.47 ms | 5.5.1 (2026-08-03) | local measurement; [lua.org](https://www.lua.org/versions.html) |
| LuaJIT 2.1 (rolling) | A with FFI; B-conditional without FFI and with JIT off | mlua (`luajit`) | none found | count hook does not fire in JIT code (measured) | allocator cap works (measured) | coroutines | 12.8 KB bare heap; ~30 KB RSS per state (measured) | not in current bench | rolling, commit 2026-11-11 | [FFI docs](https://luajit.org/ext_ffi_semantics.html) |
| Rhai | B | native (`rhai`) | via Wasm build only | `set_max_operations`, `on_progress` | size caps on strings, arrays, maps, variables; no byte budget | no async found | unknown | 112.02 ms | 1.27.0 (2026-10-21) | [limits.rs](https://github.com/rhaiscript/rhai/blob/main/src/api/limits.rs) |
| Rune | B-conditional | native (`rune`) | none | `budget::with` (opt-in) | `rune_alloc::limit::with` (opt-in) | yes: native async/await, select, join | unknown | not in current bench | 0.14.2 (2026-05-22) | [budget.rs](https://github.com/rune-rs/rune/blob/main/crates/rune/src/runtime/budget.rs), [async book](https://rune-rs.github.io/book/async.html) |
| Koto | B-conditional | native (`koto`) | none | wall-clock `execution_limit` only | none found | unknown | unknown | 49.33 ms | 0.16.1 (2026-01-05) | [koto repo](https://github.com/koto-lang/koto) |
| Roto | B-conditional | native (`roto`) | none | unknown | unknown | unknown | unknown | 12.04 ms | crate 0.13.0 (2026-10-19) | [roto](https://codeberg.org/NLnetLabs/roto) |
| piccolo | B-conditional | native, stackless | none | fuel via `Executor::step` | design goal: bounded memory | yes: stackless VM, async `Sequence`s | unknown | not benchmarked | 0.3.3 (2024-06-16) | [piccolo](https://github.com/kyren/piccolo) |
| Risor v3 (alpha) | B-conditional | native Rust impl | native TypeScript impl | steps, deadline, host cancel | allocation units | unknown | unknown | unknown | npm 3.0.0-alpha.2 (2026-11-12) | [risor](https://github.com/deepnoodle-ai/risor) |
| CEL | B | `cel` 0.15.0 | `@bufbuild/cel`, `@marcbachmann/cel-js` | non-Turing-complete; cost limits | via cost | n/a (expressions) | small | n/a | cel-go 0.33.2 (2026-10-30) | [cel-go](https://github.com/cel-expr/cel-go) |
| minijinja | B | native 3.1.0 | `minijinja-js` (Wasm) | `fuel` feature | `fuel` feature | n/a (templates) | unknown | n/a | 3.1.0 (2026-11-07) | [minijinja](https://github.com/mitsuhiko/minijinja) |
| jaq (jq) | B-conditional | `jaq-core`, `jaq-all` | jq-wasm (C jq on Emscripten) | none; host must time out | none | n/a (sync iterators) | unknown | n/a | 3.1.2 (2026-10-21) | [jaq](https://github.com/01mf02/jaq) |
| JSONata | B-conditional (isolate only) | jsonata-rs (partial) | `jsonata` 2.2.2 | none built in | none | `evaluate()` is async since 2.0 | unknown | n/a | 2.2.2 (2026-07-16) | [GHSA-8gq3-vp5j-2grp](https://github.com/advisories/GHSA-8gq3-vp5j-2grp) |
| wasmoon (Lua 5.4 in Wasm) | B-conditional (stale) | n/a | `wasmoon` | unknown | Wasm linear memory | yes: JS promises via `:await()` | 393 kB bundle (130 kB gzip) | heapsort 15.3 ms vs Fengari 389.9 ms (vendor) | npm 1.16.0 (2023-12-08) [stale] | [wasmoon](https://github.com/ceifa/wasmoon) |
| AssemblyScript, MoonBit, Grain (compile to Wasm) | B for execution | via wasmtime | compilers on npm | Wasm runtime fuel or epoch | Wasm memory maximum | via host imports | depends on module | n/a | AS 0.28.20 (2026-07-22) | see Neo section |

#### Local measurements made for this report (Lua 5.5.1 and LuaJIT)
Conditions: AMD EPYC 7443P (48 hardware threads), Linux 6.12 (Debian 13), gcc -O2, Homebrew shared libraries Lua 5.5.1 and LuaJIT 2.1.1794214635 (GC64). Each state used a counting `lua_Alloc`. RSS was read from `/proc/self/statm`. Host calls were timed over 10M-iteration Lua loops with the empty-loop time subtracted. Single run, 2026-11-13. The "safe" library set is base, string, table, math, coroutine, and utf8; LuaJIT's 5.1 API has no utf8 library and puts coroutine in base. These are first-party measurements, not from a published source.

| Metric | Lua 5.5.1 | LuaJIT 2.1 (rolling, Nov 2026) |
|---|---|---|
| Heap bytes, bare `lua_newstate` | 5,001 | 12,752 |
| Heap bytes after opening the safe libraries | 13,064 | 25,032 |
| Heap bytes after `luaL_openlibs` (all) | 18,817 | 36,012 |
| RSS delta per live state (1,000 states, safe libraries) | ~16.0 KB | ~29.6 KB |
| Create, open safe libraries, close | 23.6 µs | 26.9 µs |
| Heap per suspended coroutine (10,000 coroutines, small closure) | 1,119 B | 533 B |
| C host call, no-op `f(i)` | 14.5 ns | 7.3 ns |
| C host call, 11-byte string in and copied out | 48.3 ns | 22.1 ns |
| 1 MiB allocator cap, script grows a table without bound | `pcall` returns "not enough memory"; peak 0.90 MB; state still usable | same; peak 0.55 MB; state still usable |
| Count hook with a 1e8-instruction budget on `while true do ... end` | fires; error after 639 ms | **never fires with the JIT on** (killed by a 5 s alarm); fires after 242 ms with `jit.off()` |
| Shared library size | 344,688 B (`liblua.so.5.5.1`) | 602,712 B (`libluajit-5.1.so`) |

#### Classification of every runtime found (Group A, B, or B-conditional)
Group B (credible in-process boundary):
- Luau: purpose-built sandbox for "actively malicious" code. It removes io and package, reduces os and debug, makes standard globals read-only, removes bytecode loading, and has interrupts and host memory limits — [Luau sandboxing](https://luau.org/sandbox).
- PUC Lua 5.4/5.5 with stripped stdlib (no io, os, package, or debug; text-only `load`): CPU and memory limits enforced through the hook and allocator APIs (measured above). Production precedent: Wikimedia's LuaSandbox runs "untrusted Lua 5.1 code" with `setMemoryLimit`/`setCPULimit` — [LuaSandbox](https://www.mediawiki.org/wiki/LuaSandbox).
- Rhai: designed "to not bring down the host system, regardless of what a script may do"; operation, call-depth, and size limits — [Rhai safety](https://rhai.rs/book/safety/index.html), [limits.rs](https://github.com/rhaiscript/rhai/blob/main/src/api/limits.rs).
- CEL (cel-go, cel-rust, @bufbuild/cel): "non-Turing complete"; evaluation is linear in expression and input size — [cel-go README](https://github.com/cel-expr/cel-go). Kubernetes uses it with runtime cost budgets — [Kubernetes CEL](https://kubernetes.io/docs/reference/using-api/cel/).
- Expr (Go): "Memory-Safe" and "Always Terminating" (vendor), with 2025 DoS CVEs fixed — [Expr README](https://github.com/expr-lang/expr).
- minijinja: `fuel` feature "can be used to limit the time and memory that untrusted templates can use" — [minijinja lib.rs docs](https://github.com/mitsuhiko/minijinja/blob/main/minijinja/src/lib.rs).
- Anything compiled to Wasm and run under a Wasm runtime with fuel or epoch limits (wasmoon, jq-wasm, AssemblyScript, MoonBit, Grain output, mlua's `wasm32-wasip` Lua/Luau builds) — [mlua README](https://github.com/mlua-rs/mlua).
- PRQL (compiler only; it emits SQL and executes nothing) — [PRQL README](https://github.com/PRQL/prql).

B-conditional (capability-limited by design but weakly hardened, or missing a limit):
- Rune: opt-in budget and memory limits; modest adoption (~188K crate downloads, versus 14.7M for Rhai) — [crates.io rune](https://crates.io/crates/rune), [crates.io rhai](https://crates.io/crates/rhai).
- Koto: wall-clock timeout only; no memory cap found — [koto runtime source](https://github.com/koto-lang/koto).
- Roto: limits unknown — [roto](https://codeberg.org/NLnetLabs/roto).
- piccolo: self-described "experimental"; releases stalled since 2024 — [piccolo](https://github.com/kyren/piccolo).
- Risor v3: "an alpha and a request for comment" — [Risor](https://github.com/deepnoodle-ai/risor).
- jaq and gojq: no fuel or limits (gojq supports context cancellation) — [gojq README](https://github.com/itchyny/gojq).
- JSONata, LiquidJS, Saxon-JS, xslt-processor, oK: pure JS, so only as strong as the surrounding V8 isolate. JSONata and LiquidJS both had 2026 code-execution CVEs — [GHSA-8gq3-vp5j-2grp](https://github.com/advisories/GHSA-8gq3-vp5j-2grp), [GHSA-gf2q-c269-pqgc](https://github.com/advisories/GHSA-gf2q-c269-pqgc).
- go-jsonnet and jrsonnet: no CPU or memory limits; imports must be restricted — [Jsonnet README](https://github.com/google/jsonnet).
- CUE, Nickel, Dhall, KCL: no CPU or memory limits found.
- OPA/Rego (`http.send` must be disabled) and regorus — [OPA HTTP built-ins](https://www.openpolicyagent.org/docs/policy-reference/builtins/http).
- Tengo — [Tengo interoperability](https://github.com/d5/tengo/blob/master/docs/interoperability.md); gopher-lua; golua (alpha quotas); Shopify go-lua.
- Fengari; luau-web (single maintainer); wasmoon (stale).
- Uiua with the `SafeSys` backend; Goal without its `os` package; Janet after `(sandbox :all)`.
- Wren, Squirrel, AngelScript, Gravity, Berry, Umka: small C/C++ interpreters with host-registered I/O and weak or unknown limits.
- Nemo (Rust Datalog), xee (Rust XPath/XSLT), regorus, Tera, handlebars-rust, liquid-rust, CozoDB (stale).

Group A (needs host-level isolation):
- LuaJIT with FFI. Its docs say "the FFI library is not safe for use by untrusted Lua code" — [LuaJIT FFI semantics](https://luajit.org/ext_ffi_semantics.html).
- Lute and Lune (standalone Luau runtimes with file and network I/O) — [Lute README](https://github.com/luau-lang/lute).
- Pallene: AOT compiles to native `.so` through a C compiler — [Pallene](https://github.com/pallene-lang/pallene).
- C++ Jsonnet: "not hardened" for untrusted code — [Jsonnet README](https://github.com/google/jsonnet).
- libjq (native C; reads env and module files; 2024–2025 CVEs) — [jq 1.8.0 release](https://github.com/jqlang/jq/releases/tag/jq-1.8.0).
- Handlebars.js: compiles to JS; many 2026 JS-injection CVEs — [GHSA-8r5x-fm3f-whwj](https://github.com/advisories/GHSA-8r5x-fm3f-whwj).
- Nunjucks: "not safe to run user-defined templates" — [Nunjucks API docs](https://github.com/mozilla/nunjucks/blob/master/docs/api.md).
- libxslt: 2025 use-after-free CVEs — [NVD CVE-2025-24855](https://nvd.nist.gov/vuln/detail/CVE-2025-24855).
- Janet by default (FFI, filesystem, subprocess); Daslang ("99% safe, not 100%"); Mun (native LLVM).
- CBQN with `•FFI`, J, ngn/k, and native Uiua with its default system backend.
- Yaegi (full Go interpreter; classification from design, not verified here).
- Soufflé (generates C++).
- Pkl (JVM or native binary; provisional).
- Rye, Mochi, Jac, Agentlang, PDL, BAML: runtimes or frameworks with built-in file, network, or LLM I/O.
- Native-only neo languages: Pony, Inko, Koka, Austral, Vale, Unison, Bend/HVM.

#### One-line catalog from dbohdan/embedded-scripting-languages (provisional, not individually reviewed)
- The list was last updated 2026-10-04 and includes, beyond the runtimes above: Ada/HAC, ArkScript, Asp, GoAWK, libmawk, libfawk, EndBASIC (Rust), MY-BASIC, Boron, PicoC, tcc, Mono, Cicada, DWScript, Falcon, fe, Atlast/FTH/pForth (Forth), GameMonkey Script, Gentee (Go), Groovy, HashLink and Neko (Haxe), BeanShell, Jinx, LIL, Lily, ljs, Lua.ex, LuaJ, Lua-ML, luerl, MoonSharp, Moirai (Kotlin), Mond, Never, Pascal Script, PH7, ephp, Pluto (a C++ Lua dialect), pocketlang, Erlog/Golog/ichiban (Prolog), QuakeC qcvm, Quirrel (C++ Squirrel fork), Rebol, Red, NetRexx/ooRexx, SGScript ("sandboxed evaluation" listed as a feature), Shine, simpleeval, Snek, SquiLu, Toy, Wirefilter (Rust), ZetScript, and zygomys — [dbohdan list](https://github.com/dbohdan/embedded-scripting-languages).
- Default provisional classification: C/C++ interpreters that ship OS libraries are Group A until reviewed; pure-Rust or pure-Go expression evaluators such as Wirefilter and simpleeval are likely B-conditional.

### Inferences
- **Benchmark shortlist, tier 1:**
  - Luau via mlua in Rust, with `sandbox(true)`, an interrupt, a memory limit, and async functions.
  - Luau and Lua 5.5 compiled to Wasm and run inside agentOS's existing Wasm runtime. This gives Wasm-level isolation with fuel or epoch interruption.
  - Lua 5.5 via mlua with a stripped stdlib.
  - Rhai, with Rhai Grain enabled.
  - Rune, for native async.
  - Risor v3's TypeScript and Rust implementations: a new design explicitly aimed at LLM-written logic.
  - Data set: CEL, jaq, and minijinja.
- **Tier 2:** Koto, Roto, piccolo, wasmoon or luau-web in Node, JSONata inside a V8 isolate, jrsonnet, Uiua with `SafeSys`, and AssemblyScript compile-then-run, where compile latency is the key unknown.
- **Skip for untrusted code:** LuaJIT, unless FFI is removed and the JIT is off, which forfeits most of its advantage. Also skip Handlebars, Nunjucks, libxslt, native jq, and dormant runtimes (Wren, Squirrel, ChaiScript, Ketos, Mun, Dyon, Gluon).
- **Per-session memory planning:** at about 16 KB RSS per Lua 5.5 state plus about 1.1 KB per suspended coroutine (measured), 10,000 concurrent suspended sandboxes with one state each cost roughly 170 MB before user data. Lua's footprint is two to three orders of magnitude below a typical JS isolate; the JS isolate number comes from other researchers' scope.
- **Async without blocking host threads is natural in Lua/Luau.** A host tool call can be a coroutine yield back to the host, as mlua's `create_async_function` does. The host's event loop resumes the coroutine later, so a suspended guest is just its coroutine stack and state.
- **Parallel tool calls:** expose either a host `parallel({...})` that joins futures, or let the guest spawn several coroutines that each yield. This also works inside Wasm, because Lua coroutines live in linear memory, so no Asyncify or JSPI is needed for the yield-to-host pattern.
- **Pairing to evaluate:** Luau's gradual types plus Teal (a single `tl.lua` compiler that can run inside the sandbox) could give agents type errors before execution, similar to Risor v3's checker.

### Gaps
- The WebSearch budget for this session ran out after four searches. Discovery of 2026 agent languages, Hacker News or Lobsters measurements, and additional benchmarks relied on known URLs and GitHub, crates.io, npm, and NVD APIs instead.
- Not measured: per-state memory and host-call cost for Luau, Rhai, Rune, Koto, Roto, piccolo, wasmoon, luau-web, Fengari, and Risor. These should be the first numbers collected in the benchmark phase.
- Compile latency is unmeasured for AssemblyScript, MoonBit, Grain, Gleam, and Roc. Only vendor claims were found.

## Lua family: PUC Lua 5.4/5.5, LuaJIT, Luau, Ravi, Pallene, Fengari, wasmoon, mlua, piccolo, Go Luas, and compile-to-Lua dialects

### Takeaway
Lua states are as small as their reputation suggests: about 5 KB of heap bare and about 13 KB with safe libraries in Lua 5.5.1 (measured). Allocator caps and count hooks give reliable memory and CPU limits in PUC Lua. LuaJIT's count hooks do not fire inside JIT-compiled loops (measured), and its FFI is officially unsafe for untrusted code. Luau is the best-hardened variant and the default recommendation, with mlua as the Rust embedding. Redis's 2024–2025 Lua CVEs, including a CVSS 10.0 use-after-free, show that a C Lua VM exposed to adversarial scripts needs defense in depth: a minimal library set, no bytecode loading, and ideally Wasm or process isolation around it.

### Cited Findings

#### Luau (record)
- (1) Identity:
  - Roblox's Lua 5.1-derived language "to support a gradual type system as well as limiting the set of standard libraries … and implements extra sandboxing features to be able to run unprivileged code" — [dbohdan list](https://github.com/dbohdan/embedded-scripting-languages).
  - The interpreter is a portable C bytecode interpreter. An optional native code generator targets x64 and arm64 and compiles only the functions or modules the user marks; it does no tracing compilation — [Luau performance](https://luau.org/performance).
  - Latest release 0.746 (2026-11-07), MIT, with weekly cadence and last commit 2026-11-11 — [Luau releases](https://github.com/luau-lang/luau/releases).
- (2) **Group B.**
  - The sandbox threat model covers untrusted code that may be "actively malicious." It removes `io` and `package`; reduces `os` to `clock`, `date`, `difftime`, and `time`; reduces `debug` to `traceback` and `info`; and removes `dofile`, `loadfile`, and `module`. `collectgarbage` is limited to "count" — [Luau sandboxing](https://luau.org/sandbox).
  - Bytecode loading is removed (`loadstring` rejects bytecode; `string.dump` and `load` are removed). Standard libraries, the string metatable, and globals are read-only, including against `rawset` and `setmetatable`. Roblox gives each script its own global table that proxies to built-ins — [Luau sandboxing](https://luau.org/sandbox).
  - There is no `__gc` metamethod; tag-based destructors run host-side only — [Luau sandboxing](https://luau.org/sandbox).
  - Stated residual risks: `getfenv`/`setfenv` complicate isolation between trusted and untrusted code. The C++ stack "is not formally proven," but the page says compiler and stdlib vulnerabilities are "very rare and usually found and fixed quickly" (vendor claim). Memory safety is partly addressed through fuzzing — [Luau sandboxing](https://luau.org/sandbox).
  - No repository security advisories were found for luau-lang/luau via the GitHub API on 2026-11-13. That shows absence of published advisories, not of bugs — [GitHub repo advisories API](https://github.com/luau-lang/luau/security).
- (3) Embedding:
  - Rust: mlua features `luau`, `luau-jit`, and `luau-vector4` — [mlua README](https://github.com/mlua-rs/mlua). Vendored source comes from crate `luau0-src` 0.23.0+luau745 (2026-11-03) — [crates.io luau0-src](https://crates.io/crates/luau0-src).
  - Node/web: `luau-web` 1.5.1 (2026-10-11), "bindings for Luau that targets websites, Node.JS, and Typescript," by a single third-party author — [npm luau-web](https://www.npmjs.com/package/luau-web).
  - mlua also supports Luau on `wasm32-unknown-unknown` with a WASI C runtime and on `wasm32-wasip` — [mlua README](https://github.com/mlua-rs/mlua).
- (4) Resource controls:
  - The global interrupt handler is guaranteed to be called "eventually," at function calls or loop iterations. A single long-running C function can delay it. Roblox Studio uses a 10 s watchdog — [Luau sandboxing](https://luau.org/sandbox).
  - There are no memory limits by default; the host can configure limits on Luau allocations. Memory exhaustion "does not cause memory safety issues" but can get the process killed — [Luau sandboxing](https://luau.org/sandbox).
  - mlua adds `set_memory_limit`, which raises `Error::MemoryError`, plus `used_memory` and `set_interrupt`. The interrupt can return `VmState::Yield`, but yields "only at yieldable points of execution (not across metamethod/C-call boundaries)" — [mlua Lua docs](https://docs.rs/mlua/latest/mlua/struct.Lua.html).
- (5) Host calls and async:
  - mlua's `create_async_function` wraps a Rust async function. It "must be called inside Lua coroutine (`Thread`)", and an executor polls the resulting `AsyncThread` — [mlua Lua docs](https://docs.rs/mlua/latest/mlua/struct.Lua.html).
  - mlua async works "for all Lua versions including Luau" with any executor — [mlua README](https://github.com/mlua-rs/mlua).
  - Luau "namecall" reduces method-call interop cost on userdata, and "fastcalls" run common builtins without a stack frame — [Luau performance](https://luau.org/performance).
  - The memory cost of a suspended Luau coroutine is unknown; Lua 5.5 is ~1.1 KB, measured.
- (6) HTTP: the core VM has none; the host must provide fetch. mlua ships async HTTP client examples built on Rust crates — [mlua README](https://github.com/mlua-rs/mlua). The standalone Lute runtime includes networking, which makes it Group A — [Lute README](https://github.com/luau-lang/lute).
- (7) Footprint:
  - The core interpreter loop and builtins are about 16 KB of x64 code, and values take 16 bytes (vendor) — [Luau performance](https://luau.org/performance).
  - Per-state heap and RSS are unknown (not measured).
- (8) Speed:
  - 11.82 ms on script-bench-rs (Luau with `sandbox(true)`, inliner on, optimization level 2), fastest of the embeddable interpreters, behind only Rust compiled to Wasm (wasmtime 2.71 ms, wasmi 7.04 ms) — [script-bench-rs](https://github.com/khvzak/script-bench-rs), [mlua bench source](https://github.com/khvzak/script-bench-rs/blob/master/src/mlua.rs).
  - Luau's own claims: "noticeably faster than Lua 5.x" and on some workloads matching the LuaJIT interpreter; the compiler handles about 950K lines/s on one Ryzen 5900X core; `table.sort` is about 4x faster (all vendor) — [Luau performance](https://luau.org/performance).
- (9) Snapshot and resume: no built-in state serialization found.
- (10) Ecosystem fit:
  - Gradual type checker — [Luau typecheck](https://luau.org/typecheck).
  - Native vector type — [Luau performance](https://luau.org/performance).
  - mlua's `serde` feature maps Lua values to and from serde types, enabling JSON via the host — [mlua README](https://github.com/mlua-rs/mlua).
  - No regex, crypto, or compression in the sandboxed library; the host must supply them.
- (11) Production untrusted-code use: Roblox at platform scale — [Luau sandboxing](https://luau.org/sandbox).

#### PUC Lua 5.5 and 5.4 (record)
- (1) Identity:
  - Lua 5.5.0 was released 22 Dec 2025. The current release is 5.5.1 (03 Aug 2026), and 5.4.9 came out 25 Aug 2026. An HTML comment on lua.org says "We are getting ready to release Lua 5.5.2" — [lua.org versions](https://www.lua.org/versions.html).
  - Lua 5.5 adds declarations for global variables, named vararg tables, read-only for-loop variables, decimal float printing, and more constructor levels — [Lua 5.5 readme](https://www.lua.org/manual/5.5/readme.html). The versions page also notes incremental major collections — [lua.org versions](https://www.lua.org/versions.html).
  - Bytecode interpreter in C, MIT license.
- (2) **Group B** when the stdlib is stripped (no `io`, `os`, `package`, `debug`, `dofile`, or `loadfile`; text-only `load`). Memory and CPU limits were verified by measurement above.
  - Security history: the Redis Lua CVEs below concern the Lua interpreter Redis bundles; CVE-2024-31449 is in its bundled `bit` library. Whether upstream 5.4 or 5.5 is affected was not established (see Gaps).
- (3) Embedding:
  - Rust: mlua `lua55`/`lua54` with `vendored`. The `lua-src` crate is at 551.1.0 (2026-10-24) — [crates.io lua-src](https://crates.io/crates/lua-src). mlua 0.12.2 (2026-10-03) — [crates.io mlua](https://crates.io/crates/mlua).
  - Node: wasmoon (Lua 5.4 via Emscripten) and Fengari (Lua 5.3 in JS); see below.
- (4) Resource controls: `lua_Alloc` returning NULL above a cap produces a catchable "not enough memory" error, and the state remains usable (measured). `lua_sethook` with `LUA_MASKCOUNT` interrupts `while true do end` (measured). mlua exposes `set_memory_limit`, `set_hook`, and `set_global_hook`; a hook "can return an error to enforce execution limits" — [mlua Lua docs](https://docs.rs/mlua/latest/mlua/struct.Lua.html).
- (5) Host calls and async: a C host call costs 14.5 ns; with an 11-byte string in and out it costs 48.3 ns. A suspended coroutine uses 1,119 B (all measured). mlua 0.12 added coroutine lifecycle callbacks (create, resume, yield) "across all Lua versions" — [mlua v0.12.0 release](https://github.com/mlua-rs/mlua/releases/tag/v0.12.0).
- (7) Footprint (measured): 5,001 B bare, 13,064 B with safe libraries, 18,817 B with all libraries; ~16 KB RSS per live state; 23.6 µs create, open, and close; 344,688 B shared library.
- (8) Speed: 15.47 ms on script-bench-rs (Lua 5.5 via mlua 0.12.2) — [script-bench-rs](https://github.com/khvzak/script-bench-rs).
- (11) Production untrusted-code use:
  - Wikimedia's LuaSandbox (used by Scribunto) exists "to allow safely running untrusted Lua 5.1 code from within PHP," with `setMemoryLimit` and `setCPULimit`. Its requirements included "a strong sandbox and strict limitations on memory and CPU time usage, since it would be executing untrusted user code on production servers" — [LuaSandbox](https://www.mediawiki.org/wiki/LuaSandbox), [Scribunto](https://www.mediawiki.org/wiki/Extension:Scribunto).
  - Redis `EVAL` runs scripts from authenticated users — [Redis advisory](https://redis.io/blog/security-advisory-cve-2025-49844/).

#### LuaJIT (record)
- (1) Rolling releases with no tags; last commit 2026-11-11. The local build reports 2.1.1794214635 — [LuaJIT repo](https://github.com/LuaJIT/LuaJIT). The `luajit-src` crate is at 210.7.4+c6ffc14 (2026-09-27) — [crates.io luajit-src](https://crates.io/crates/luajit-src).
- (2) **Group A** with FFI. The docs say "The FFI library provides no memory safety" and "the FFI library is not safe for use by untrusted Lua code. If you're sandboxing untrusted Lua code, you definitely don't want to give this code access to the FFI library or to any cdata object" — [LuaJIT FFI semantics](https://luajit.org/ext_ffi_semantics.html).
- **B-conditional** without FFI, because of JIT CVEs and the hook caveat below:
  - CVE-2024-25176: stack-buffer-overflow in `lj_strfmt_wfnum`, CVSS 9.8 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2024-25176).
  - CVE-2024-25177: unsinking of `IR_FSTORE` leads to DoS, CVSS 7.5 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2024-25177).
  - CVE-2024-25178: out-of-bounds read in the stack-overflow handler, CVSS 9.1 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2024-25178).
- (4) Measured: the instruction-count hook never fired on a JIT-compiled infinite loop, which had to be killed by a 5 s alarm. It fired after `jit.off()`. The 1 MiB allocator cap works with a custom allocator in GC64 mode.
- (5) and (7) Measured: 7.3 ns no-op C call; 22.1 ns string echo; 533 B per suspended coroutine; 12,752 B bare and 25,032 B with safe libraries; ~29.6 KB RSS per state; 602,712 B library.

#### mlua (Rust embedding layer for all of the above)
- 0.12.2 (2026-10-03). It supports Lua 5.1–5.5, LuaJIT, and Luau, with features `async`, `send`, `serde`, `vendored`, and `luau-jit`. Lua 5.1–5.5 and Luau build for `wasm32-unknown-unknown` with a WASI C runtime and for `wasm32-wasip` — [mlua README](https://github.com/mlua-rs/mlua).
- Caveat from its own Safety section: "mlua does not provide absolute safety even without using unsafe … This library contains a huge amount of unsafe code" — [mlua README](https://github.com/mlua-rs/mlua).
- Downloads: 8.8M total, 2.8M recent — [crates.io mlua](https://crates.io/crates/mlua).
- Luau `sandbox(true)` sets libraries and globals read-only, activates `safeenv`, adds a local environment table that proxies reads, and allows only `collectgarbage("count")` — [mlua Lua docs](https://docs.rs/mlua/latest/mlua/struct.Lua.html).

#### Lua for Node: wasmoon, Fengari, luau-web, lua-wasm-bindings
- **wasmoon** compiles official Lua to Wasm.
  - JS promises can be awaited from Lua with `:await()`, which "will yield the Lua execution until the promise completes."
  - Benchmark (vendor): heapsort of 2k numbers ×10 took 15.267 ms versus Fengari's 389.923 ms. Bundle size is 393 kB plain and 130 kB gzip; Fengari is 214 kB and 69 kB — [wasmoon README](https://github.com/ceifa/wasmoon).
  - npm 1.16.0 (2023-12-08) and last commit 2025-01-18, so stale — [npm wasmoon](https://www.npmjs.com/package/wasmoon).
  - **B-conditional:** Wasm containment, but stale and with an unclear CPU-limit API.
- **Fengari** is "an entire Lua VM rewritten in JS" (Lua 5.3) — [wasmoon README](https://github.com/ceifa/wasmoon). Release v0.1.5 (2025-12-26) — [Fengari releases](https://github.com/fengari-lua/fengari/releases). **B-conditional:** it lives in the host JS realm with no memory cap.
- **luau-web** 1.5.1 (2026-10-11) is a single-maintainer project — [npm luau-web](https://www.npmjs.com/package/luau-web).
- **lua-wasm-bindings** 0.5.3 "currently only includes the bindings used to test TypescriptToLua," so it is not production-grade — [npm lua-wasm-bindings](https://www.npmjs.com/package/lua-wasm-bindings).

#### piccolo (Rust stackless Lua VM)
- "An experimental stackless Lua VM implemented in pure Rust." Its goals are to "confidently sandbox untrusted Lua scripts" and be "resilient against DoS," meaning scripts should not panic the interpreter or use unbounded memory — [piccolo README](https://github.com/kyren/piccolo).
- The host drives `Executor::step` and "can stop or pause or change tasks at any time." Async `Sequence`s exist. A few isolated `unsafe` sources remain, and the README warns that Spectre-class risks apply even with a memory-safe VM — [piccolo README](https://github.com/kyren/piccolo), [design blog](https://kyju.org/blog/piccolo-a-stackless-lua-interpreter/).
- v0.3.3 (2024-06-16), last commit 2025-07-10, CC0 — [piccolo releases](https://github.com/kyren/piccolo/releases).
- **B-conditional:** experimental and incomplete Lua coverage.

#### Go-hosted Lua (needs a Go sidecar or Wasm build to reach Rust or Node hosts)
- **gopher-lua** v1.1.2 (2026-04-01) is Lua 5.1 in Go. `L.SetContext(ctx)` cancels execution. Registry and call-stack sizes are configurable, but "a registry which is too small … will ultimately result in a panic" — [gopher-lua README](https://github.com/yuin/gopher-lua). **B-conditional:** no memory cap.
- **golua (arnodel)** v0.4.1 (2026-11-05) implements Lua 5.5 (with a 5.4 branch). Its "safe execution environment (alpha)" restricts CPU and memory via `runtime.callcontext({kill={memory=...}})` and `-cpulimit`. The README also demonstrates `go.import('net/http')`, which must not be exposed — [golua README](https://github.com/arnodel/golua). **B-conditional.**
- **Shopify go-lua** (Lua 5.2 in Go) has no releases and was last committed 2026-10-07 — [go-lua](https://github.com/Shopify/go-lua). **B-conditional.**
- Tengo's benchmark (date unknown, possibly stale) has go-lua at 4,028 ms and GopherLua at 4,409 ms for fib(35), versus Tengo at 2,315 ms — [Tengo README](https://github.com/d5/tengo).

#### Ravi and Pallene
- **Ravi:** last release 1.0-beta11 (2023-01-14, stale) but active commits through 2026-11-13 — [Ravi](https://github.com/dibyendumajumdar/ravi). Listed as a C Lua implementation — [dbohdan list](https://github.com/dbohdan/embedded-scripting-languages). **B-conditional:** JIT and small user base.
- **Pallene:** "a statically typed and ahead-of-time compiled sister language to Lua." `pallenec` compiles `foo.pln` to a native `foo.so` with a C compiler; no releases — [Pallene README](https://github.com/pallene-lang/pallene). **Group A** (native code) with high compile latency.

#### Compile-to-Lua dialects (inherit the target VM's group)
- **Teal** v0.24.8 (2025-10-13): typed Lua dialect whose "core compiler has no dependencies and is implemented as a single `tl.lua`" — [Teal README](https://github.com/teal-language/tl).
- **Fennel** 1.6.1: "a lisp that compiles to Lua" with "zero overhead" and compile-time macros — [Fennel README](https://github.com/bakpakin/Fennel).
- **MoonScript** v0.8.0 (2026-10-22) — [moonscript](https://github.com/leafo/moonscript).
- **YueScript** v0.34.3 (2026-09-30): "derived from MoonScript 0.5.0" — [YueScript README](https://github.com/IppClub/YueScript).

#### Standalone Luau runtimes (Group A)
- **Lute** v1.0.0 (2026-04-16): standard libraries "for file I/O, networking"; the 1.0 release added a WebSocket client and server — [Lute README](https://github.com/luau-lang/lute), [Lute v1.0.0](https://github.com/luau-lang/lute/releases/tag/v1.0.0).
- **Lune** v0.11.1 (2026-10-21), MPL-2.0 — [Lune](https://github.com/lune-org/lune).

#### Lua sandbox security track record (Redis 2024–2025, LuaJIT 2024)
- **CVE-2025-49844 ("RediShell"):** a crafted Lua script can "manipulate the garbage collector, trigger a use-after-free and potentially lead to remote code execution." CVSS 10.0 per Redis. Fixed in OSS 8.2.2, 8.0.4, 7.4.6, and 7.2.11 (2025-10-03). It requires authenticated access — [Redis advisory](https://redis.io/blog/security-advisory-cve-2025-49844/).
  - Wiz reported it on 2025-05-16; reports describe the bug as about 13 years old — [The Hacker News](https://thehackernews.com/2025/10/13-year-redis-flaw-exposed-cvss-100.html).
- Disclosed the same day:
  - CVE-2025-46817: integer overflow leading to possible RCE, CVSS 7.0 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-46817).
  - CVE-2025-46818: "manipulate different LUA objects and potentially run their own code in the context of another user," CVSS 6.0 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-46818).
  - CVE-2025-46819: out-of-bounds read or crash, CVSS 6.3 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-46819).
- Earlier Redis Lua CVEs:
  - CVE-2024-46981: GC manipulation leading to RCE — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2024-46981).
  - CVE-2024-31449: stack overflow in the bundled `bit` library — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2024-31449).
  - CVE-2022-0543: Debian-specific packaging Lua sandbox escape, CVSS 10.0 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2022-0543).

### Inferences
- Luau should be the primary benchmark target. Use PUC Lua 5.5 as the minimal-footprint control. Both can run in-process through mlua and in agentOS's Wasm path, which provides containment even if a C VM bug like the Redis UAF exists.
- The Redis CVE pattern (GC manipulation, the `bit` library, metatables, `unpack`) points at a minimal surface: no bytecode loading, no extra C libraries, read-only globals, and one state per tenant. Luau's design already enforces most of this.
- LuaJIT is the fastest raw Lua, but untrusted use requires FFI off plus either JIT off or an external watchdog. Its count hooks are unreliable in compiled traces (measured), and its 2024 CVEs scored up to 9.8. It is not worth benchmarking for the untrusted path.
- Teal and Fennel compilers are themselves Lua code, so they could run inside the same sandbox. That would let agents write typed or more token-compact source compiled in-sandbox with no host toolchain. This is unverified for Teal-to-Luau compatibility.

### Gaps
- Not established whether CVE-2025-49844, CVE-2025-46817, CVE-2025-46818, and CVE-2025-46819 affect upstream Lua 5.4/5.5 or only Redis's Lua 5.1 fork and its extra libraries.
- NVD lookups for the Lua 5.4 CVEs CVE-2022-28805 and CVE-2022-33099 failed in this pass.
- Unknown:
  - Luau per-state memory, coroutine size, and host-call cost.
  - Whether luau-web exposes interrupts or memory limits.
  - wasmoon's hook API.
  - Whether Fengari's Node build exposes `io`.
  - Luau's bug-bounty coverage.
- No built-in snapshot or serialize-and-resume was found for any Lua variant; Eris and Pluto-style persistence libraries were not reviewed.

## Rust-hosted languages: Rhai, Rune, Koto, Roto, Gluon, Dyon, Mun, Steel, Ketos, and published comparisons

### Takeaway
script-bench-rs (refreshed 2026-10-03) ranks the Rust-embeddable interpreters on a host-call-heavy sort: Luau 11.82 ms ≈ Roto 12.04 < Lua 5.5 15.47 < rquickjs 36.38 < Koto 49.33 < Boa 79.99 < Rhai 112.02. Rhai is the safest-by-design Rust-native option, with many limits and fuzzing, but it is the slowest and has no async. Rune has first-class async and opt-in budget and memory limits but far less adoption. Koto has only a wall-clock timeout. Gluon, Dyon, Mun, and Ketos are not credible for this use.

### Cited Findings
- **script-bench-rs (published comparison):**
  - Goal: "benchmark most popular embedded scripting languages for Rust," covering "not only the performance of code evaluation but interoperability with Rust too."
  - Versions: boa 0.22.0, koto 0.16.1, mlua 0.12.2 (Lua 5.5 and Luau), rhai 1.26.1, roto 0.12.0, rquickjs 0.14.0, wasmi 2.0.0, wasmtime 49.0.2, rustc 1.99.0, macOS 27.0, Apple M5 Max — [script-bench-rs](https://github.com/khvzak/script-bench-rs). Results were refreshed in commit "Update dependencies and refresh results" on 2026-10-03 — [commits](https://github.com/khvzak/script-bench-rs/commits).
  - Workload: create 10,000 host-owned objects via a host constructor, from random 8–23 character strings built with one host `rand` call per character, then quicksort them using a host-implemented `__lt`. That is one host call per comparison — [sort_userdata.lua](https://github.com/khvzak/script-bench-rs/blob/master/scripts/sort_userdata.lua).
  - Results in ms: wasmtime 2.71, wasmi 7.04, mlua_luau 11.82, roto 12.04, mlua_lua55 15.47, rquickjs 36.38, koto 49.33, boa 79.99, rhai 112.02 — [results chart](https://github.com/khvzak/script-bench-rs/blob/master/Sort%20Rust%20objects.png).
  - Rune, LuaJIT, and piccolo are not in the current set — [script-bench-rs](https://github.com/khvzak/script-bench-rs).

#### Rhai (record)
- (1) Identity:
  - Tree-walking AST interpreter plus "Rhai Grain" bytecode VM (1.8–2x faster, vendor). Rhai 1.27.0 (2026-10-21) removed Grain's experimental label, added `no_ast` (runs only Grain bytecode) and lazy-loaded modules, and fixed fuzzing-found bugs — [Rhai 1.27.0 release](https://github.com/rhaiscript/rhai/releases/tag/v1.27.0).
  - Apache-2.0 per GitHub license detection; 14.7M downloads — [crates.io rhai](https://crates.io/crates/rhai).
  - README claim (vendor): "1 million iterations in 0.14 sec on a single-core 2.6 GHz Linux VM"; "relatively little unsafe code"; supports WebAssembly — [Rhai README](https://github.com/rhaiscript/rhai).
- (2) **Group B.**
  - "Rhai is designed to not bring down the host system, regardless of what a script may do." The `unchecked` feature "disables all safety checks," so do not enable it — [Rhai safety](https://rhai.rs/book/safety/index.html).
  - CVE-2024-36760: stack overflow via recursive `eval_stmt_block` in ≤1.18.0 — [GHSA-67fv-9r7g-432h](https://github.com/advisories/GHSA-67fv-9r7g-432h).
- (3) Embedding: Rust crate; Wasm builds — [Rhai README](https://github.com/rhaiscript/rhai).
- (4) Limits: `set_max_operations`, `set_max_call_levels`, `set_max_expr_depths`, `set_max_string_size`, `set_max_array_size`, `set_max_map_size`, `set_max_variables`, `set_max_functions`, `set_max_modules`, and the `on_progress` callback — [limits.rs](https://github.com/rhaiscript/rhai/blob/main/src/api/limits.rs), [max operations](https://rhai.rs/book/safety/max-operations.html), [progress](https://rhai.rs/book/safety/progress.html).
- (5) Async: none documented. The "non-design" page lists no closures-as-first-class, no GC, and no JIT, but does not mention async — [Rhai non-design](https://rhai.rs/book/about/non-design.html).
- (8) Speed: slowest in script-bench-rs (112.02 ms) — [script-bench-rs](https://github.com/khvzak/script-bench-rs).

#### Rune (record)
- (1) Stack-based VM; "memory safe through reference counting"; first-class async with generators; hot reloading — [Rune README](https://github.com/rune-rs/rune). Version 0.14.2 (2026-05-22), Apache-2.0 per GitHub, ~188K downloads — [crates.io rune](https://crates.io/crates/rune).
- (2) **B-conditional:** limits are opt-in and the user base is small. No advisories were found in the GitHub advisory DB on 2026-11-13.
- (4) Limits:
  - "The budget is disabled, but can be enabled by wrapping your function call in `with`" — [budget.rs](https://github.com/rune-rs/rune/blob/main/crates/rune/src/runtime/budget.rs).
  - Memory limits are "plugged in at the Rust allocator level, and does not account for allocator overhead" — [rune-alloc limit](https://github.com/rune-rs/rune/blob/main/crates/rune-alloc/src/limit/mod.rs).
- (5) Async: scripts `.await` host functions such as `http::get(url).await`. `select` waits on several futures, and `future::join([...])` runs them concurrently — [Rune async book](https://rune-rs.github.io/book/async.html).

#### Koto, Roto, and others
- **Koto** 0.16.1 (2026-01-05), MIT, ~34K downloads — [crates.io koto](https://crates.io/crates/koto). Its only limit is `with_execution_limit(Duration)`, which returns a Timeout error — [koto source](https://github.com/koto-lang/koto). 49.33 ms in script-bench-rs. **B-conditional.**
- **Roto** (NLnet Labs) moved to Codeberg; crate 0.13.0 (2026-10-19) — [Roto](https://codeberg.org/NLnetLabs/roto), [crates.io roto](https://crates.io/crates/roto). 12.04 ms in script-bench-rs; compile model and limits not verified. **B-conditional.**
- **Gluon:** v0.18.4 (2026-08-06), statically typed functional — [gluon](https://github.com/gluon-lang/gluon). Low activity; not a candidate.
- **Dyon:** crate 0.51.3 (2026-09-08), but the last GitHub release is from 2018 — [crates.io dyon](https://crates.io/crates/dyon).
- **Mun:** `mun_runtime` 0.4.0 (2022-12-12, stale); native LLVM output, so Group A — [crates.io mun_runtime](https://crates.io/crates/mun_runtime).
- **Steel** (Scheme): v0.8.2/0.8.3 (2026) — [steel](https://github.com/mattwparas/steel). Lisp family is covered by another researcher.
- **Ketos:** last commit 2020-01-17, dead — [ketos](https://github.com/murarth/ketos).
- **evalexpr:** 13.1.0, an expression evaluator under the AGPL-3.0 license — [evalexpr](https://github.com/ISibboI/evalexpr).
- **Risor v3** also ships a native Rust implementation (Go section).

### Inferences
- For a Rust host, Luau via mlua dominates every Rust-native language on both speed and hardening. Choose Rhai only if a pure-Rust dependency matters, and Rune only if async ergonomics in the guest language are worth less battle-testing.
- Rhai's limits count operations and container sizes rather than bytes. Real memory caps would need a counting global allocator or a per-tenant process or Wasm boundary.

### Gaps
- Per-engine memory, cold start, and host-call cost for Rhai, Rune, Koto, and Roto are unmeasured.
- Roto's execution model (JIT versus interpreter) and limits are unverified.
- Not found: whether Rhai has any async story, and whether Rune can drive many suspended VMs on one thread cheaply, with its suspended-VM memory cost.

## Go-hosted languages: Tengo, Risor, Expr, Anko, CEL-go, Yaegi, Goal

### Takeaway
Go runtimes reach Rust or Node hosts only via a sidecar process or a large Go-to-Wasm build, which limits their fit. The notable 2026 development is Risor v3, an alpha "typed expression language" with independent native implementations in Go, TypeScript, and Rust. It has deterministic step and allocation limits and a pre-run checker, and its README targets logic written by "an LLM." Expr and CEL are always-terminating expression languages.

### Cited Findings
- **Risor v3 (alpha):**
  - "A small, typed expression language you can embed in Go, TypeScript and Rust. It is checked before it runs, and it cannot run away with your CPU or memory." It is pitched for logic that "your users, your operators or an LLM" write — [Risor README](https://github.com/deepnoodle-ai/risor).
  - Three independent implementations, "none uses WebAssembly or cgo." Limits:
    - Steps: default 1,000,000.
    - Allocation units: default 1,000,000.
    - Deadline: off by default.
    - Depth: 200.
    - "A `catch` in the program cannot catch a limit."
  - It has "no statements, no loops, no reassignment" and reads host data in place with no copy — [Risor README](https://github.com/deepnoodle-ai/risor).
  - npm `@deepnoodle/risor` 3.0.0-alpha.2 (2026-11-12) — [npm](https://www.npmjs.com/package/@deepnoodle/risor). The repo moved from risor-io to deepnoodle-ai — [GitHub](https://github.com/deepnoodle-ai/risor).
  - Risor v2 (Go-only, v2.2.0 2026-08-18) has "no module imports, and no third-party ecosystem — by design" — [Risor v2 README](https://github.com/deepnoodle-ai/risor/tree/v2).
- **Tengo:**
  - v3.0.0 (2025-05-24) — [Tengo releases](https://github.com/d5/tengo/releases).
  - "Script **does not**" include modules unless `SetImports` adds them. `SetMaxAllocs` and `SetMaxConstObjects` cap objects, and `RunContext` cancels — [Tengo interoperability](https://github.com/d5/tengo/blob/master/docs/interoperability.md), [script.go](https://github.com/d5/tengo/blob/master/script.go).
  - fib(35) table (date unknown, possibly stale): Tengo 2,315 ms, go-lua 4,028, GopherLua 4,409, goja 5,194, starlark-go 6,954, gpython 11,324, Yaegi 11,715, otto 48,539, Anko 52,821 — [Tengo README](https://github.com/d5/tengo).
  - **B-conditional.**
- **Expr:**
  - v1.17.8 (2026-02-14). "Memory-Safe" and "Always Terminating … designed to prevent infinite loops" (vendor). Used by Google Cloud, Uber Eats marketplace customization, and GoDaddy Pro — [Expr README](https://github.com/expr-lang/expr).
  - `WithContext` passes a `context.Context` into host functions — [Expr configuration](https://github.com/expr-lang/expr/blob/master/docs/configuration.md).
  - CVEs: CVE-2025-29786 (unbounded input exhausts parser memory, fixed 1.17.0) — [GHSA-93mq-9ffx-83m2](https://github.com/advisories/GHSA-93mq-9ffx-83m2); CVE-2025-68156 (unbounded recursion in builtins causes a stack-overflow panic, fixed 1.17.7) — [GHSA-cfpf-hrx2-8rv6](https://github.com/advisories/GHSA-cfpf-hrx2-8rv6).
  - **Group B** with input-size caps.
- **CEL-go:**
  - Moved to github.com/cel-expr/cel-go, v0.33.2 (2026-10-30). "A non-Turing complete language"; "CEL evaluates linearly with respect to the size of the expression and the input" — [cel-go README](https://github.com/cel-expr/cel-go).
  - Advisory GHSA-gcjh-h69q-9w9g (2026-07-24, medium): JSON private fields exposed via NativeTypes — [GitHub advisories](https://github.com/advisories/GHSA-gcjh-h69q-9w9g).
  - **Group B.**
- **Anko:** only tags (v0.1.15); slowest in Tengo's table — [anko](https://github.com/mattn/anko). **B-conditional and dormant.**
- **Yaegi:** v0.16.3 (2026-11-05) is a Go interpreter — [yaegi](https://github.com/traefik/yaegi). **Group A**, provisional; see Gaps.
- **Goal:**
  - v1.8.1 (2026-10-02, Codeberg): "an embeddable array programming language with a bytecode interpreter" — [Goal README](https://codeberg.org/anaseto/goal).
  - IO lives in a separate package: "Package os provides Goal's default IO/OS builtins" — [goal/os](https://codeberg.org/anaseto/goal/src/branch/master/os).
  - **B-conditional** without that package.

### Inferences
- Risor v3's TypeScript implementation is a rare non-JS, non-Wasm guest language that runs natively inside a Node host or V8 isolate. Benchmark it despite the alpha label.
- Expressions without loops cannot express multi-step code-mode scripts. Risor v3, CEL, and Expr fit "filter, transform, decide" steps rather than whole agent programs.

### Gaps
- Risor v3's async or host-function model and per-environment memory were not reviewed.
- Yaegi's default stdlib exposure was not verified in this pass.

## C/C++/Zig-hosted languages: Wren, Squirrel, AngelScript, Gravity, Janet, Berry, Umka, ChaiScript, Daslang, Cyber, Io, Pawn, Ficl, and others

### Takeaway
None of these beats Lua or Luau on the combination of sandbox design, limits, and track record. Most are small C/C++ VMs whose I/O comes from host-registered functions, so they are B-conditional at best. Several are dormant: Wren since 2021, Squirrel since 2022, ChaiScript since 2018, and Pawn is archived. Janet is Group A until its `sandbox` capability flags are applied.

### Cited Findings
- **AngelScript:** current version 2.39.0 (November 9, 2026) — [AngelCode](https://www.angelcode.com/angelscript/). Statically typed and C++-hosted; limits not verified. **B-conditional.**
- **Janet:**
  - v1.43.0 (2026-11-07) — [janet releases](https://github.com/janet-lang/janet/releases).
  - `(sandbox & forbidden-capabilities)` "disable[s] feature sets … Once a feature is disabled, there is no way to re-enable it." Flags include `:all`, `:asm`, `:chroot`, `:compile`, `:env`, `:exit`, `:ffi`, `:ffi-define`, and `:ffi-jit`, and filesystem read and write — [corelib.c](https://github.com/janet-lang/janet/blob/master/src/core/corelib.c), [os.c](https://github.com/janet-lang/janet/blob/master/src/core/os.c).
  - **Group A** by default; **B-conditional** after the sandbox call.
- **Berry:** "interpreter-core's code size is less than 40KiB and can run on less than 4KiB heap" (vendor). Last release v1.1.0 (2022) with active commits — [Berry README](https://github.com/berry-lang/berry). **B-conditional.**
- **Umka:**
  - v1.5.7 (2026-08-22), statically typed — [Umka README](https://github.com/vtereshkov/umka-lang).
  - `umkaInit` takes `fileSystemEnabled` and `implLibsEnabled`, which gate filesystem access and native modules — [Umka API](https://github.com/vtereshkov/umka-lang/blob/master/doc/api.md).
  - **B-conditional.**
- **Daslang (daScript):** v0.6.5 (2026-10-31). "99% safe, not 100%"; tree interpreter, AOT to C++, and LLVM JIT; built for game-engine interop — [Daslang README](https://github.com/GaijinEntertainment/daScript). **Group A** for untrusted code.
- **Cyber:** Zig. "Embed it into your applications … on desktop or web" with WASM Web and WASI targets — [Cyber README](https://github.com/fubark/cyber). Last release "latest" 2024-11-24 and last commit 2025-12-21, so stalled. **B-conditional or unknown.**
- **Wren** 0.4.0 (2021-04-09, stale) — [wren](https://github.com/wren-lang/wren).
- **Squirrel** 3.2 (2022-02-10, stale) — [squirrel](https://github.com/albertodemichelis/squirrel). OpenTTD uses Squirrel for user-written AI and game scripts — [OpenTTD scripting](https://wiki.openttd.org/en/Development/Script/).
- **Gravity:** 0.9.9 (2026-10-11) — [gravity](https://github.com/marcobambini/gravity).
- **ChaiScript:** v6.1.0 (2018, stale) — [ChaiScript](https://github.com/ChaiScript/ChaiScript).
- **Io:** 2026 tags `stackless-alpha` and `native-final` — [Io](https://github.com/IoLanguage/io).
- **Pawn:** archived — [pawn](https://github.com/compuphase/pawn).
- **Ring:** 1.27 (2026-05-28) — [ring](https://github.com/ring-lang/ring).
- **Kuroko:** v1.5.0rc2, Python-like — [kuroko](https://github.com/kuroko-lang/kuroko).
- **hscript:** 2.7.0 (2025-11-19), Haxe subset interpreter — [hscript](https://github.com/HaxeFoundation/hscript).
- Ficl was not reviewed. Others appear in the Overview's dbohdan catalog.

### Inferences
- Only Janet (with its sandbox) and Umka offer explicit capability switches. Neither has a published memory cap. None is likely to beat Luau, so these are low-priority for benchmarking.

### Gaps
- Not verified in this pass:
  - AngelScript's line callback and memory functions.
  - Squirrel's opcode-suspension mechanism in OpenTTD.
  - Wren's limit APIs.
  - Ficl's status.
  - Whether Janet's sandbox list includes a `:net` flag; the excerpt was truncated.

## Data, query, config, and template languages for sandboxed data processing and artifact generation

### Takeaway
On Turing completeness and termination:

| Status | Languages |
|---|---|
| Non-Turing-complete or terminating by design (sources) | CEL, Dhall, CUE (per the Nickel README), Expr, JMESPath (by design, unverified here) |
| Turing-complete (sources) | Jsonnet, Nickel |
| Turing-complete in practice | jq/jaq, JSONata, XSLT, template engines with recursion |

Only CEL (cost limits), minijinja (fuel), LiquidJS and Shopify Liquid (render and memory limits), and Risor bound execution natively. The JS-realm engines (JSONata, LiquidJS, Handlebars) had 2026 code-execution CVEs and must run inside an isolate. For Rust and Node hosts, the best-fit set is:
- jaq (`jaq-core`/`jaq-all`) or jq-wasm
- CEL (`cel` crate and `@bufbuild/cel`)
- minijinja (Rust and minijinja-js)
- jrsonnet or go-jsonnet with a locked-down importer
- regorus for policy

### Cited Findings

#### jq family
- **jq** 1.8.2 (2026-06-20) — [jq releases](https://github.com/jqlang/jq/releases).
  - 1.8.0 (2025-06-01) fixed CVE-2024-23337 (integer overflow; arrays and objects are now capped at 2^29 elements), CVE-2024-53427 (NaN payload), and CVE-2025-48060 (heap buffer overflow in `jv_string_vfmt`) — [jq 1.8.0 release](https://github.com/jqlang/jq/releases/tag/jq-1.8.0).
  - **Group A** as native libjq.
- **jq-wasm** 3.0.0-jq-1.8.2 (2026-07-05): Emscripten build for Node, browsers, and Workers — [npm jq-wasm](https://www.npmjs.com/package/jq-wasm). **B-conditional.**
- **jaq:**
  - 3.1.2 (2026-10-21), MIT — [jaq releases](https://github.com/01mf02/jaq/releases).
  - 3.0 (2026-03-27) added multi-format I/O (YAML, CBOR, TOML, XML, CSV, TSV), the `jaq-all` "batteries-included" crate, and an optional thread-safe `Val` for running multiple filters in parallel. Its stated focus is "correctness, speed, and simplicity" — [jaq 3.0.0 release](https://github.com/01mf02/jaq/releases/tag/v3.0.0).
  - `jaq-core` has 4.7M downloads — [crates.io jaq-core](https://crates.io/crates/jaq-core).
  - **B-conditional:** no fuel.
- **gojq:**
  - v0.12.20 (2026-11-01) — [gojq releases](https://github.com/itchyny/gojq/releases).
  - "The result iterator may emit infinite number of values; `repeat(0)` … It may stuck with no output value; `def f: f; f`. Use `RunWithContext`" to limit. Modules are disabled by default. `WithEnvironLoader` controls what `env`/`$ENV` see. `WithFunction` and `WithIterFunction` add host functions — [gojq README](https://github.com/itchyny/gojq).

#### JSONata
- `jsonata` 2.2.2 (2026-07-16) — [npm jsonata](https://www.npmjs.com/package/jsonata). Version 2.0.0 reimplemented the evaluator "to use async functions instead of generators," and `evaluate()` is awaited — [JSONata 2.0.0 release](https://github.com/jsonata-js/jsonata/releases/tag/v2.0.0), [embedding docs](https://github.com/jsonata-js/jsonata/blob/master/docs/embedding-extending.md).
- 2026 CVEs:
  - CVE-2026-77413: "possible to execute arbitrary code with crafted expressions" due to a missing `hasOwnProperty` check; fixed 2.2.0 and 1.8.8 — [GHSA-8gq3-vp5j-2grp](https://github.com/advisories/GHSA-8gq3-vp5j-2grp).
  - CVE-2026-77415: arbitrary code execution via overwriting `$clone` and destructuring built-ins; fixed 2.2.1 — [GHSA-66mm-25pp-rfff](https://github.com/advisories/GHSA-66mm-25pp-rfff).
  - Also CVE-2026-77414 (ACE), CVE-2026-52746 (`$toMillis` resource exhaustion), CVE-2026-12208 (prototype pollution), and earlier CVE-2024-27307 — [GitHub advisories for jsonata](https://github.com/advisories?query=jsonata).
- Production: AWS Step Functions lets users transform state data with JSONata — [AWS docs](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html).
- **jsonata-rs** 0.3.4 (2025-02-03, Stedi, 25 stars) — [jsonata-rs](https://github.com/Stedi/jsonata-rs).

#### JMESPath and CEL
- **JMESPath:**
  - jmespath.js 0.16.0 (2022, stale) — [npm](https://www.npmjs.com/package/jmespath).
  - @jmespath-community/jmespath 1.5.0 (2026-10-31) — [npm](https://www.npmjs.com/package/@jmespath-community/jmespath).
  - Rust `jmespath` 0.5.0 (2026-01-19) — [crates.io](https://crates.io/crates/jmespath).
- **CEL:**
  - Spec v0.26.0 (2026-11-09) — [cel-spec](https://github.com/cel-expr/cel-spec).
  - Rust `cel` 0.15.0 (2026-10-06) — [crates.io cel](https://crates.io/crates/cel).
  - `@bufbuild/cel` 0.6.2 (2026-11-04), "a CEL evaluator for ECMAScript" — [npm](https://www.npmjs.com/package/@bufbuild/cel).
  - `@marcbachmann/cel-js` 8.0.0 — [npm](https://www.npmjs.com/package/@marcbachmann/cel-js).
  - Kubernetes: "CEL is non-Turing complete and offers a variety of production safety controls," with sections on runtime cost budgets and estimated cost limits — [Kubernetes CEL](https://kubernetes.io/docs/reference/using-api/cel/).

#### Configuration languages
- **Jsonnet:**
  - v0.22.0 (2026-03-24) for both C++ and Go — [go-jsonnet](https://github.com/google/go-jsonnet).
  - "Jsonnet is Turing-complete as it is possible to write non-terminating programs" — [Jsonnet design](https://github.com/google/jsonnet/blob/master/doc/articles/design.html).
  - Security note: for "untrusted Jsonnet code, it is best not to use the C++ implementation, as it is not hardened," and `import`/`importstr`/`importbin` "can potentially be used to exfiltrate sensitive data unless you take extra steps" — [Jsonnet README](https://github.com/google/jsonnet).
  - Rust: jrsonnet (`jrsonnet-evaluator` 0.4.2, 2026-05-05; v0.5.0 pre-releases) — [crates.io](https://crates.io/crates/jrsonnet-evaluator).
  - Scala: sjsonnet 0.7.5 (2026-09-23) — [sjsonnet](https://github.com/databricks/sjsonnet).
  - Node: `@hanazuki/node-jsonnet` 3.4.1 — [npm](https://www.npmjs.com/package/@hanazuki/node-jsonnet).
- **CUE:** v0.17.1 (2026-07-16) — [cue releases](https://github.com/cue-lang/cue/releases). CUE abandons "functions and Turing-completeness" — [Nickel README](https://github.com/nickel-lang/nickel).
- **Nickel:** 1.18.0 (2026-09-19). It "does have general functions and is Turing-complete" — [Nickel README](https://github.com/nickel-lang/nickel). Rust crate `nickel-lang-core` 0.19.0 — [crates.io](https://crates.io/crates/nickel-lang-core).
- **Dhall:** "not Turing-complete. Evaluation always terminates, no exceptions" — [Dhall README](https://github.com/dhall-lang/dhall-lang). Rust `serde_dhall` 0.13.0 (2025-09-10) — [crates.io](https://crates.io/crates/serde_dhall).
- **KCL:**
  - v0.13.2 (2026-10-19). Rust and C implementation, compiles to native and WASM, with SDKs for "Rust, Go, Python, .NET, Java and Node.js" — [KCL README](https://github.com/kcl-lang/kcl).
  - `@kcl-lang/wasm-lib` 0.12.1 — [npm](https://www.npmjs.com/package/@kcl-lang/wasm-lib).
- **Pkl:** 0.33.0 (2026-11-05). CLI ships as native binaries plus a Java jar — [Pkl CLI docs](https://pkl-lang.org/main/current/pkl-cli/index.html). `@pkl-community/pkl` 0.30.2 — [npm](https://www.npmjs.com/package/@pkl-community/pkl).

#### Policy and query languages
- **Rego:**
  - OPA v1.22.4 (2026-11-12). The `http.send` built-in returns "a HTTP response to the given HTTP request," so it is an embedded network client — [OPA HTTP built-ins](https://www.openpolicyagent.org/docs/policy-reference/builtins/http).
  - CVE-2022-36085: bypass of the deprecated `WithUnsafeBuiltins` restriction via `with` — [GHSA-f524-rf33-2jjr](https://github.com/advisories/GHSA-f524-rf33-2jjr).
  - OPA Wasm npm package `@open-policy-agent/opa-wasm` 1.10.0 (2024-11-08) — [npm](https://www.npmjs.com/package/@open-policy-agent/opa-wasm).
  - **regorus** v0.15.0 (2026-11-09; 6.7M crate downloads): "mostly compliant with" OPA v1.2.0 and "designed with Confidential Computing in mind," with C, `no_std` C, C++, C#, Go, and Python bindings plus a JS/WASM playground — [regorus README](https://github.com/microsoft/regorus), [crates.io](https://crates.io/crates/regorus).
- **PRQL:** 0.13.14 (2026-07-24) "compiles to SQL." npm `prqlc` is available — [PRQL README](https://github.com/PRQL/prql), [npm prqlc](https://www.npmjs.com/package/prqlc).
- **Datalog:**
  - Nemo v0.10.1 (Rust): "datalog-based rule engine for fast and scalable analytic data processing in memory." Its browser app "runs entirely" in the browser — [Nemo README](https://github.com/knowsys/nemo).
  - Soufflé 2.5 (2025-03-24) — [souffle](https://github.com/souffle-lang/souffle).
  - CozoDB 0.7.6 (2023-12, stale): embeddable from Python, NodeJS, and Clojure, and in browsers via WASM — [Cozo README](https://github.com/cozodb/cozo).
  - Scallop (tags to 0.2.4) — [scallop](https://github.com/scallop-lang/scallop).
  - ascent 0.8.1, crepe 0.2.0, and datafrog 2.0.1 are compile-time Rust libraries, unsuitable for runtime untrusted text — [crates.io ascent](https://crates.io/crates/ascent).

#### Template languages
- **minijinja:**
  - 3.1.0 (2026-11-07), implemented "in Rust and Go and is also available via WASM for JavaScript" — [minijinja README](https://github.com/mitsuhiko/minijinja).
  - The `fuel` feature limits "time and memory that untrusted templates can use"; `stacker` permits deeper recursion; parse-time recursion is "always limited" — [minijinja lib.rs](https://github.com/mitsuhiko/minijinja/blob/main/minijinja/src/lib.rs).
  - minijinja-js 3.1.0 uses `wasm-bindgen` and is "useful if you … want to evaluate as a sandbox in a browser for a user or on the backend," with "limited functionality compared to the Rust version" — [npm minijinja-js](https://www.npmjs.com/package/minijinja-js).
  - No advisories found.
- **Tera:** 2.4.0 (2026-09-11) — [crates.io tera](https://crates.io/crates/tera).
- **Liquid:**
  - Shopify Liquid v5.13.0 has `render_score_limit` and `cumulative_render_score_limit` — [Liquid README](https://github.com/Shopify/liquid).
  - LiquidJS 10.30.1 (2026-10-28) — [npm liquidjs](https://www.npmjs.com/package/liquidjs). It had more than 15 CVEs in 2026, including CVE-2026-45618, "possible to execute arbitrary code with crafted templates" (fixed 10.26.0) — [GHSA-gf2q-c269-pqgc](https://github.com/advisories/GHSA-gf2q-c269-pqgc). Several were `memoryLimit` and `renderLimit` bypasses and path traversal — [GitHub advisories for liquidjs](https://github.com/advisories?query=liquidjs).
  - liquid-rust 0.26.11 — [crates.io liquid](https://crates.io/crates/liquid).
- **Handlebars:**
  - handlebars.js 4.7.10 (2026-10-05). CVE-2026-106446: "JavaScript Injection via AST Type Confusion in compile" (fixed 4.7.10), plus about 10 other 2026 advisories — [GHSA-8r5x-fm3f-whwj](https://github.com/advisories/GHSA-8r5x-fm3f-whwj).
  - handlebars-rust 6.4.4 (105M downloads) — [crates.io handlebars](https://crates.io/crates/handlebars).
- **Nunjucks:** 3.2.4 (2023, stale): "nunjucks does not sandbox execution so it is not safe to run user-defined templates" — [Nunjucks API docs](https://github.com/mozilla/nunjucks/blob/master/docs/api.md).
- **XSLT:**
  - libxslt use-after-free CVEs CVE-2025-24855 and CVE-2024-55549, fixed in 1.1.43 — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2024-55549).
  - xee (Rust): "almost complete" XPath 3.1, "incomplete" XSLT 3.0, a shared bytecode interpreter, v0.1.6 (2025-08-21) — [xee README](https://github.com/Paligo/xee).
  - `xslt-processor` 5.1.3 (pure JS, 2026-11-08) — [npm](https://www.npmjs.com/package/xslt-processor).
  - `saxon-js` 2.7.0 (2024-10-17) — [npm](https://www.npmjs.com/package/saxon-js).
- **Google minja** (C++ Jinja subset): last commit 2025-09-22 — [minja](https://github.com/google/minja).

### Inferences
- For agent data processing inside agentOS:
  - Run jaq natively in the Rust host with a watchdog thread and output caps, or compile it to Wasm for fuel.
  - Use CEL for predicates and minijinja for text and HTML artifacts.
  - JSONata, LiquidJS, and Handlebars should only run inside the V8 guest isolate, never in the Node host realm. Their 2026 CVEs convert template or expression injection into host code execution.
- Jsonnet's import exfiltration warning generalizes: any language with file or URL imports needs a host-controlled resolver that denies by default. This applies to Jsonnet, Dhall, Pkl, KCL, and jq modules.

### Gaps
- Not verified in this pass:
  - Turing-completeness of jq/jaq and JSONata (whether JSONata has recursive functions).
  - Dhall remote URL imports.
  - Pkl's resource allowlist flags.
  - XSLT `document()` network access.
  - Whether OPA Wasm policies support `http.send`.
  - Regorus limits.
- The LiquidJS DoS-limits page (liquidjs.com/tutorials/dos.html) returned 404; option names came only from advisory titles.

## Array languages for data processing: ngn/k, oK, BQN, Uiua, dzaima/APL, J, and Goal

### Takeaway
Array languages are terse, which may help token efficiency. However, their native runtimes generally include FFI or system access, so they are Group A, and none has CPU or memory limits. The embeddable options are Uiua, a Rust crate whose I/O goes through a pluggable `SysBackend` with a `SafeSys` implementation, and Goal, a Go library whose IO builtins live in a separate `os` package. ngn/k, CBQN (`FFI=0`), and oK can run as Wasm or JS inside an isolate.

### Cited Findings
- **Uiua:**
  - 0.19.1 (2026-09-03), Rust, MIT — [Uiua releases](https://github.com/uiua-lang/uiua/releases), [crates.io uiua](https://crates.io/crates/uiua).
  - `pub trait SysBackend` mediates `file_read_all`, `file_write_all`, `tcp_listen`, `tcp_connect`, `run_command_capture`, and similar calls. A `SafeSys` backend struct exists — [sys/mod.rs](https://github.com/uiua-lang/uiua/blob/main/src/sys/mod.rs).
- **Goal:** v1.8.1 (2026-10-02) — [Goal](https://codeberg.org/anaseto/goal). Embedding docs are at [pkg.go.dev](https://pkg.go.dev/codeberg.org/anaseto/goal), and IO is in the `os` package — [goal/os](https://codeberg.org/anaseto/goal/src/branch/master/os).
- **ngn/k:**
  - GNU AGPLv3, last commit 2026-07-21. The README points to "an actively maintained fork at https://codeberg.org/growler/k," an embedding example (`kes`), and a browser build — [ngn/k readme](https://codeberg.org/ngn/k).
  - The AGPL may matter for embedding (inference).
- **oK:** JS (k6 dialect), MIT, last commit 2026-07-26 — [oK](https://github.com/JohnEarnest/ok).
- **BQN:**
  - CBQN v0.12.0 has `•FFI` via libffi, disabled with `FFI=0`. An Emscripten target produces `BQN.js`/`BQN.wasm` — [CBQN README](https://github.com/dzaima/CBQN).
  - BQN spec and reference implementation (ISC) — [BQN](https://github.com/mlochbaum/BQN).
- **dzaima/APL:** v0.2.0 (2021, stale) — [dzaima/APL](https://github.com/dzaima/APL).
- **J:** jsource tags 9.7.1 and 9.8.0-beta3, active 2026-11-13 — [jsource](https://github.com/jsoftware/jsource).
- **Kona:** last commit 2023 (stale) — [kona](https://github.com/kevinlawler/kona).
- **ktye/i:** k in Go and Wasm, last commit 2026-05 — [ktye/i](https://github.com/ktye/i).

### Inferences
- Uiua with `SafeSys` and a host watchdog is the only array language worth a smoke benchmark for in-process Rust embedding. Its glyph-heavy syntax may tokenize poorly for LLMs (unverified). Goal is the K-like option, but only for Go hosts or Wasm.

### Gaps
- What `SafeSys` permits exactly, Uiua's per-instance memory, and LLM token efficiency of array languages were not measured or found. Dyalog APL was not researched.

## Neo and Wasm-native languages (2022–2026): can they compile and run fast enough for short-lived agent scripts?

### Takeaway
Languages that compile to Wasm (AssemblyScript, MoonBit, Grain, Virgil) or to JS (Gleam, Effekt, MoonBit) produce output that runs as Group B under agentOS's existing Wasm or V8 sandboxes. The open question is per-script compile latency, for which only vendor claims exist. AssemblyScript's compiler and MoonBit's compiler worker are on npm, so they can compile inside a Node host. Native-only languages are Group A and need heavy toolchains, which makes them poor fits. Several neo languages now pitch themselves as AI-oriented: MoonBit as "AI-native," Bend2 as blocking "AI mistakes via proof," and Jac (agent section).

### Cited Findings
- **MoonBit:**
  - Describes itself as "an AI-native general-purpose programming language," covering "language design, compiler, runtime, IDE, and build system"; IDEA, Shenzhen — [moonbitlang.com](https://www.moonbitlang.com/).
  - No GitHub releases; core library Apache-2.0 with daily commits — [moonbitlang/core](https://github.com/moonbitlang/core).
  - npm `@moonbit/moonc-worker` 0.1.202611052 (2026-11-05) suggests a JS/worker build of the compiler — [npm](https://www.npmjs.com/package/@moonbit/moonc-worker).
  - Its 2024 AI post (vendor claim, older than 2024's end) argues for flattened, nesting-light syntax for "linear" LLM generation and KV-cache friendliness. It describes a sampler doing real-time syntax and semantic checks with a "modest performance penalty of approximately 3%," without stated conditions — [MoonBit AI blog](https://www.moonbitlang.com/blog/moonbit-ai).
- **AssemblyScript:** v0.28.20 (2026-07-22), Apache-2.0, TypeScript-like to Wasm; compiler on npm — [npm assemblyscript](https://www.npmjs.com/package/assemblyscript), [GitHub](https://github.com/AssemblyScript/assemblyscript).
- **Grain:** v0.7.2 (2026-02-08), LGPL-3.0; "compiles to WebAssembly via Binaryen" — [Grain README](https://github.com/grain-lang/grain).
- **Gleam:** v1.19.2 (2026-10-12), compiles to Erlang and JS — [gleam](https://github.com/gleam-lang/gleam).
- **Effekt:** v0.84.0 (2026-11-09), effect handlers, npm `@effekt-lang/effekt` — [effekt](https://github.com/effekt-lang/effekt).
- **Koka:** v3.2.9 (2026-09-18) — [koka](https://github.com/koka-lang/koka).
- **Roc:**
  - "alpha4-rolling" (2025-08-26). The README links a tutorial for the "new compiler" — [Roc](https://github.com/roc-lang/roc). The platform docs page exists — [Roc platforms](https://www.roc-lang.org/platforms) — but the fetch returned only navigation text.
  - UPL-1.0 license.
- **Unison:** 1.5.0 (2026-10-02) — [unison](https://github.com/unisonweb/unison).
- **Pony:** 0.78.2 (2026-11-12) — [ponyc](https://github.com/ponylang/ponyc).
- **Inko:** v0.21.1 — [inko](https://github.com/inko-lang/inko).
- **Austral:** v0.2.0 (2023, stale) — [austral](https://github.com/austral/austral).
- **Vale:** v0.2.0, dormant — [Vale](https://github.com/ValeLang/Vale).
- **Lobster:** v2026.8 — [lobster](https://github.com/aardappel/lobster).
- **Virgil:** active 2026-11-10 — [virgil](https://github.com/titzer/virgil).
- **Bend:**
  - Repo moved to bendlang/bend, v2.0.40 (2026-11-06). Now pitched as "a fast language that blocks AI mistakes via proof … we still need an ambiguity-free language to communicate our intents to the AIs" — [Bend README](https://github.com/bendlang/bend).
  - HVM1 was renamed; HVM2, HVM3, and HVM4 are separate repos — [HVM2](https://github.com/HigherOrderCO/HVM2).
- **Scrapscript:** v0.0.3 (2024-06), Python interpreter, stale — [scrapscript](https://github.com/tekknolagi/scrapscript).
- **Ecstasy/XVM:** a "container-based architecture" with "resource injection," as in `@Inject Console console;`. Last release 2022, active commits — [xvm README](https://github.com/xtclang/xvm).
- **Rye:**
  - v0.2.81 (2026-11-06), Go, Rebol-inspired. "Pure/impure function separation." Built-in HTTP and file examples (`Read %name.txt |… |Post* https://…`). Builds to WASM — [Rye README](https://github.com/refaktor/rye).
  - **Group A** by default.
- **Vine:** "experimental … based on interaction nets," compiles to Ivy and runs on IVM — [Vine README](https://github.com/VineLang/vine).
- **Darklang:** active (tags to v0.0.113) — [dark](https://github.com/darklang/dark).
- **Wing:** v0.85.x (2025) — [wing](https://github.com/winglang/wing).

### Inferences
- **AssemblyScript** is the most practical neo option to benchmark for compile-then-run in a Node host. It is TS-like, and LLMs know TS, so the compile step is the main cost to measure.
- **MoonBit** is the second option to evaluate, if its compiler worker is usable headless.
- **Native-toolchain languages are not viable** for per-script compilation in a multi-tenant process. These are Pony, Inko, Koka via C, Austral, Pallene, Mun, and Roc's native platforms.
- **Capability-model languages are design references** rather than runtimes to embed. Ecstasy injection and Austral's linear capabilities show "no ambient authority" built into the language; Roc's platforms are probably similar but unverified.

### Gaps
- No measured compile latency for any neo language. Searches for Hacker News or Lobsters numbers could not run.
- Not verified:
  - Roc's platform capability model and new-compiler interpreter.
  - MoonBit's 1.0 status and open-source compiler status.
  - Grain, Gleam, and Effekt compiler startup times.
  - Unison, Koka, and Effekt embedding.

## Languages designed explicitly for LLM agents or code mode (2024–2026)

### Takeaway
Most "agent languages" are orchestration DSLs or frameworks: PDL in YAML, BAML, Jac, Mochi, Agentlang, LMQL, APPL, Plang, and Shire. They run with ambient file, network, or LLM access (Group A) rather than as sandboxes. The security-relevant designs make different choices:
- Pel restricts capabilities in its grammar instead of sandboxing; it is a paper only, with no code link found.
- CaMeL separates control flow (from the trusted query) from data flow and enforces capability policies at tool calls.
- Risor v3 uses a pre-run checker plus deterministic step and allocation metering.
- Monty (Python, covered elsewhere) is a Rust-built interpreter with no filesystem, environment, or network, and host-only external functions.

Code mode itself is mainstream: Cloudflare (TypeScript API in isolates, 2025-09-26) and Anthropic ("up to 98.7%" context reduction, 2025-11-04).

### Cited Findings
- **Pel** (arXiv:2505.13453, Behnam Mohammadi; v1 2025-04-03, v2 2025-06-09):
  - A Lisp-inspired, homoiconic language for orchestrating LLM agents that is easy for LLMs to generate. It restricts agent capabilities "at the syntax level rather than relying on sandboxing."
  - Features: piping, first-class closures, natural-language conditions evaluated by LLMs, a REPL with Common Lisp-style restarts and LLM helper agents, and automatic parallelization from static dependency analysis.
  - The arXiv page lists no code link — [arXiv 2505.13453](https://arxiv.org/abs/2505.13453).
  - A secondary source says no public implementation exists (not independently verified) — [Ted Neward notes](https://research.tedneward.com/languages/pel.html).
- **CaMeL** ("Defeating Prompt Injections by Design," Debenedetti, Shumailov, Fan, Hayes, Carlini, Fabian, Kern, Shi, Terzis, Tramèr; 2025-03-24, revised 2025-06-24):
  - "CaMeL explicitly extracts the control and data flows from the (trusted) query." It uses capabilities to block exfiltration over unauthorized data flows.
  - It solves 77% of AgentDojo tasks "with provable security," versus 84% for an undefended system — [arXiv 2503.18813](https://arxiv.org/abs/2503.18813).
  - Code: Apache-2.0, last commit 2025-06-20 — [camel-prompt-injection](https://github.com/google-research/camel-prompt-injection).
- **PDL** (IBM; arXiv 2410.19135, 2024-10-24): "a simple declarative data-oriented language" based on YAML for LLM, tool, and agent workflows — [arXiv 2410.19135](https://arxiv.org/abs/2410.19135). The repo is at v0.9.3 (2026-02-26) with an `icml-26` tag, requires Python 3.11+, and integrates "tools (code execution & APIs)" — [PDL README](https://github.com/IBM/prompt-declaration-language).
- **BAML** (vendor claims): "the programming language for agents." It "looks like TypeScript"; "a type system like Rust, but compiles even faster than Go"; "Types persist at runtime. There is no `any`"; typed, statically analyzed errors; "green threads, and colorless concurrency like Go"; a built-in "stdlib for agents"; callable from TS, Python, Go, C#, and Java — [BAML README](https://github.com/BoundaryML/baml).
- **Jac** (jaseci-labs/jac v0.39.2, 2026-11-09): "a programming language built for coding agents and the humans who direct them." It is Python-like and "compiles it to Python bytecode, JavaScript, and na[tive]" — [Jac README](https://github.com/jaseci-labs/jac). **Group A.**
- **Mochi** (v0.16.0, 2026-06-01, Go):
  - "Agent-friendly: structured, safe, and embeddable"; statically typed bytecode VM; runs as an MCP server.
  - It has built-in `load "people.yaml"` / `save … to "adults.json"` file I/O and LLM `generate` — [Mochi README](https://github.com/mochilang/mochi).
  - **Group A** by default.
- **Agentlang** (0.11.0): "a declarative DSL (built on TypeScript) for creating AI Agents," with native integrations for LLMs, databases, and auth — [Agentlang README](https://github.com/agentlang-ai/agentlang).
- **Risor v3:** see Go section — [Risor](https://github.com/deepnoodle-ai/risor).
- **Monty** (Python subset; detailed by the Python researcher):
  - "A secure Python sandbox, written in Rust, for code written by AI." A new sandbox takes "under 1ms from a running pool" (vendor).
  - "Filesystem, environment variables and network do not exist inside the sandbox." Resource limits and snapshots are documented. v1.6.0 (2026-11-11) — [Monty README](https://github.com/pydantic/monty).
- **Dormant or older agent DSLs:**
  - LMQL v0.7.3 (2023-10, stale) — [lmql](https://github.com/eth-sri/lmql).
  - APPL v0.2.1 (2024-12) — [appl](https://github.com/appl-team/appl).
  - Plang (LGPL-2.1, active commits) — [plang](https://github.com/PlangHQ/plang).
  - Shire v1.3.5 (2025-02) — [shire](https://github.com/phodal/shire).
- **Code-mode context:**
  - Cloudflare "Code Mode: the better way to use MCP" (2025-09-26) converts MCP tools into a TypeScript API that generated code calls — [Cloudflare blog](https://blog.cloudflare.com/code-mode/).
  - Anthropic "Code execution with MCP" (2025-11-04) claims context overhead reduced "by up to 98.7%" (vendor) — [Anthropic engineering](https://www.anthropic.com/engineering/code-execution-with-mcp).
  - smolagents v1.26.0 (Python CodeAgent) — [smolagents](https://github.com/huggingface/smolagents).

### Inferences
- **Recurring design choices:**
  - Capabilities declared by the host rather than ambient: Pel, CaMeL, Risor ("declare what the program can see"), Monty, Ecstasy, and Roc.
  - Static checking before execution, so agents get errors before side effects: Risor, BAML, Jac, Mochi, and MoonBit.
  - Deterministic metering: Risor.
  - Data-flow tracking to resist prompt injection: CaMeL.
  - Syntax chosen for reliable LLM generation: Pel's minimal homoiconic grammar and MoonBit's flattened syntax.
  - Resumability or snapshots: Monty snapshots, Pel's restarts, and Lua/piccolo coroutines as the natural mechanism.
- **No agent-designed language found is both production-grade and a credible in-process sandbox for Rust or Node hosts.** Risor v3 (alpha) is closest. For benchmarks, the practical path remains a hardened general embeddable language (Luau, Lua) plus CaMeL-style policy enforced at the host tool-call boundary.

### Gaps
- Salesforce Agent Script docs returned HTTP 403, so it is unverified. The Dana agent language was not verified.
- Searches for other 2025–2026 agent languages from arXiv or companies could not run because the WebSearch budget was exhausted.
- Not verified:
  - Whether CaMeL's interpreter is a custom Python-subset interpreter.
  - Pel implementation availability.
  - BAML's runtime isolation model.
