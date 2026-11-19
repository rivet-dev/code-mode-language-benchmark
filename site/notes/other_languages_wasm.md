# Sandboxable runtimes for other general-purpose languages, shells and SQL engines (agent code mode), as of 2026-11-13

Scope: languages other than JS/TS and Python, plus shells, Unix tools and SQL/query engines, for LLM-agent scripts embedded in or launched by Rust and Node hosts. Starlark, Lua, Rhai/Wren/Janet-style embeddables and jq/CEL/Jsonnet are covered elsewhere.

Method: six parallel research passes (Ruby/PHP/Perl; R/Julia/Haskell/OCaml; Go/.NET/Dart/Swift; JVM; Lisp/BEAM/Prolog/Tcl; shells) plus my own pass on SQL engines and cross-cutting Wasm facts. Sources are primary wherever possible: repos, release APIs, npm/crates/Maven metadata and docs. The session's shared web-search budget ran out partway through. After that, facts came from direct fetches of known URLs and package-registry APIs, so a few long-tail items rest on search-result summaries; they are marked as such. Group labels follow the brief: **B** = credible in-process boundary, **A** = needs OS/VM isolation, **B-cond** = capability-limited but weakly hardened.

## Overview: compact comparison table, grouping, and what to benchmark

### Takeaway
Almost every non-JS/Python language reaches Group B only by running inside Wasm or a V8 isolate. Native interpreters are Group A by their maintainers' own statements; the exceptions are native SQLite, Tcl safe interpreters and a few Rust or Go embeddables, which are B-conditional.

**Most promising for code mode**, meaning low marginal cost per session plus real async host calls:
- SCI's JS build, running inside agentOS's existing V8 isolate
- ruby.wasm on Node, and kobako (mruby in wasmtime) on Rust
- just-bash on Node and bashkit on Rust, which expose tools as async commands
- Trealla Prolog, as a reference for its async model
- As data engines: DuckDB-Wasm, SQLite Wasm/wa-sqlite and PGlite

**Heavy but agent-relevant:**
- webR: 24.6k R packages, but its worker blocks on every host call.
- @php-wasm: GPL, with no limits API.
- zeroperl.

**Skip or low priority:**
- Julia, Swift, Dart, Kotlin/Wasm, TeaVM, Scala.js and Go compile-to-Wasm: each needs a native compiler outside the sandbox for every script.
- GraalVM isolates: no Rust or Node binding.
- CheerpJ and WebVM: browser-only.
- Full-system emulators: useful only as an upper bound.

### Cited Findings

#### Compact comparison table
Abbreviations: B* means the module is Group B, but its default JS bridge gives the guest the host JS realm's authority and must be replaced or confined to a stripped isolate. "host" means the limit is enforced by the embedding Wasm engine or V8 isolate. Details and further citations are in the per-language sections below.

| Runtime | Lang | Impl | Latest (date) | Group | Rust / Node embedding | Limits | Async host calls | HTTP | Size / start | Src |
|---|---|---|---|---|---|---|---|---|---|---|
| ruby.wasm | Ruby 3.2–4.0 | CRuby VM→Wasm (WASI p1 / Emscripten) | 2.10.1 (2026-08-01) | B* | Node npm; Rust via wasmtime (p1, no bridge) | host | Yes: Asyncify Fibers (`await` in `evalAsync`) | host fetch via bridge | ruby+stdlib.wasm 32.6 MB | [npm](https://registry.npmjs.org/@ruby%2F4.0-wasm-wasi) |
| kobako | mruby | mruby VM in wasmtime, in-process | crates 0.20.0, gem 0.30.0 (2026-11-07) | B (young) | Rust crates | 4 MiB mem, 60 s defaults | sync service calls | allowlisted endpoints | instance ~3 µs after first ~500 ms (vendor) | [kobako](https://github.com/elct9620/kobako) |
| mruby (native) | mruby | C bytecode VM | 4.0.0 (2026-04-20) | B-cond (A in practice) | Rust beni; Node none | link-time allocator, instruction hook | sync | mruby-socket if built | <400 KB RAM (vendor) | [Debian, 43 CVEs](https://security-tracker.debian.org/tracker/source-package/mruby) |
| SabiRuby / mruby/edge | mruby bytecode | Rust VMs | 0.9.0 / 2.1.2 | B-cond | Rust | instruction budget (SabiRuby) | tasks wait on queues | host | unknown | [SabiRuby](https://raw.githubusercontent.com/sabiruby/sabiruby/main/README.md) |
| CRuby / JRuby / TruffleRuby | Ruby | native | — | A | magnus / rb-sys | none ($SAFE removed) | — | ambient | — | [Ruby 3.0 NEWS](https://docs.ruby-lang.org/en/3.0.0/NEWS_md.html) |
| @php-wasm (WP Playground) | PHP 7.4–8.5 | Zend→Emscripten; JSPI and Asyncify builds | 3.1.64 (2026-11-10), GPL-2.0+ | B (host-wired) | Node only | none; runtime rotation | Yes (JSPI / Asyncify) | PHP sockets via host WS→TCP proxy; fetch path in browser | php_8_4.wasm 25.5 MB | [npm](https://registry.npmjs.org/@php-wasm%2Fnode) |
| php-wasm (seanmorris) | PHP 8.0–8.5 | Emscripten | 0.2.0 (2026-10-01) | B* (Vrzno) | Node / Deno / Bun | unknown | Vrzno promises | `$window->fetch` | unknown | [README](https://github.com/seanmorris/php-wasm) |
| Wasmer php/php | PHP 8.3 | WASIX | 8.3.403 (2025-01-14) | B if WASIX gated | Rust wasmer | host | unknown | WASIX sockets | unknown | [wasmer.io](https://wasmer.io/php/php) |
| Native PHP | PHP | Zend VM | — | A | ext-php-rs | open_basedir is not a boundary | — | ambient | — | [php/policies](https://github.com/php/policies/blob/main/security-classification.rst) |
| zeroperl / zeroperl-ts | Perl 5.42 | WASI p1 reactor + Asyncify | ts 1.0.10 (2025-12-05) | B (experimental) | Node / Bun / Deno; Rust via wasmtime | 32 MiB initial (build-time) | Yes: host fn may return Promise | host functions only | zeroperl.wasm 25.4 MB | [zeroperl](https://github.com/6over3/zeroperl) |
| WebPerl | Perl | Emscripten | v0.09-beta (last push 2023) | B (browser) | browser | unknown | unknown | via JS | unknown | [WebPerl](https://webperl.zero-g.net/) |
| Native Perl + Safe.pm | Perl | interpreter | Safe 2.47 | A | — | none | — | ambient | — | [perlsecpolicy](https://perldoc.perl.org/perlsecpolicy) |
| webR | R 4.6.0 | R→Emscripten in a Worker | 0.6.1 (2026-11-10) | B-cond (A on plain Node) | npm `webr`; no Rust | no memory cap; cooperative interrupt | blocks worker (SAB + `Atomics.wait`) | sync-XHR GET; curl via WS proxy | npm 49.5 MB; initial memory 32 MB | [webR releases](https://github.com/r-wasm/webr/releases) |
| Native R (+ unix::eval_safe) | R | native | unix 1.6.0 | A | subprocess | rlimits / AppArmor | — | ambient | — | [CRAN unix](https://cran.r-project.org/package=unix) |
| Julia / JuliaC | Julia | LLVM JIT / AOT | 1.13 (2026-09-10) | A | subprocess | OS | — | ambient | startup 56.7 ms | [Julia 1.13](https://julialang.org/blog/2026/09/julia-1.13-highlights/) |
| WasmTarget.jl / WebAssemblyCompiler.jl | Julia subset | typed IR→WasmGC | unknown / 2023 | B output, A compile | Node / browser | host | JS interop | host | unknown | [WasmTarget.jl](https://grouptherapyorg.github.io/WasmTarget.jl/) |
| yaegi (native) | Go | interpreter in Go | v0.16.3 (2026-11-05) | A | Go hosts only | none; cooperative ctx cancel | goroutines | net/http if exposed | unknown | [yaegi](https://github.com/traefik/yaegi) |
| yaegi→Wasm | Go | interpreter in Wasm | community, yaegi 0.16.1 | B | Node / browser | host | via JS Promises (inferred) | Node: Go fetch disabled | 39.8 MB .wasm | [yaegi-wasm](https://github.com/Muhammad-Ayman/yaegi-wasm) |
| Go gc → wasip1 / js | Go | AOT→Wasm | go1.27.4 | B | wasmtime, wazero, Node wasi | host | wasip1: sync imports | wasip1: no outbound sockets | ~2 MB min, 10 MB+ common | [Go wiki](https://go.dev/wiki/WebAssembly) |
| TinyGo | Go subset | LLVM AOT | v0.44.0 (2026-10-28) | B | wasmtime, wazero, Spin, Extism | host | goroutines via Asyncify | wasi-http adapters | ~10 kB typical | [TinyGo releases](https://github.com/tinygo-org/tinygo/releases) |
| scriggo | Go | interpreter | v0.61.1 (2026-03-13) | B-cond | Go | unknown | — | only if enabled | unknown | [scriggo](https://github.com/open2b/scriggo) |
| Roslyn scripting / dotnet-script / FSI | C# / F# | IL + JIT | 5.6.0 / 2.0.1 | A | .NET only | none (no CAS) | Task | ambient | — | [MS Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/net-framework-tech-unavailable) |
| .NET on Wasm (+ Roslyn in Wasm) | C# | Mono IL interpreter + jiterpreter (AOT optional) | .NET 11.0.0 (2026-11-10) | B (in V8) | browser; Node via Bootsharp | host | `[JSImport]` Task↔Promise | fetch (unverified) | unknown; AOT build takes minutes | [MS Learn AOT](https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-build-tools-and-aot) |
| componentize-dotnet | C# | NativeAOT-LLVM→WASI 0.2 | 0.8.0-preview (2026-06-12) | B | wasmtime 23 | host | undocumented | undocumented | unknown | [repo](https://github.com/bytecodealliance/componentize-dotnet) |
| Dart VM | Dart | JIT / AOT | 3.14.0 (2026-11-04) | A | — | none | isolates (not a boundary) | dart:io | — | [Dart concurrency](https://dart.dev/language/concurrency) |
| dart2wasm | Dart | AOT→WasmGC | 3.14.0 | B | browsers; Wasmtime 39+ (`--standalone`) | host | js_interop | via JS | unknown | [dart.dev/web/wasm](https://dart.dev/web/wasm) |
| dart_eval | Dart | bytecode VM written in Dart | 0.8.5 (2026-05-12) | B-cond | Dart hosts only | none documented | async/await | `NetworkPermission` | "10-50x slower" than AOT (vendor) | [pub.dev](https://pub.dev/packages/dart_eval) |
| Swift SDK for Wasm | Swift | LLVM AOT→WASI p1 | 6.4.2 (2026-10-30) | B | wasmtime, WasmKit, browser | host | JavaScriptKit `await JSPromise.value` | no URLSession | unknown | [swift.org](https://www.swift.org/documentation/articles/wasm-getting-started.html) |
| GraalJS / GraalPy / GraalWasm (UNTRUSTED isolate) | JS / Python 3.13 / Wasm | Truffle + Graal JIT in a Native Image isolate | 25.5.5.0.3 (2026-11-03) | B (borderline) | no Rust/Node API (sidecar, C ABI or JNI) | hard isolate heap; MaxCPUTime; MaxStatements | Java thenables awaitable (JS); single-threaded context | host only | js-isolate 61.9–73.4 MB; python-isolate 120 MB | [GraalVM sandboxing](https://www.graalvm.org/latest/security-guide/sandboxing/) |
| TeaVM | JVM bytecode | AOT→JS / WasmGC | 0.16.0 (2026-10-02) | B (output) | Node; WasmGC needs JS loader | host | coroutines | host | unknown | [TeaVM releases](https://github.com/konsoletyper/teavm/releases) |
| Kotlin/Wasm | Kotlin | AOT→WasmGC | 2.4.21 (2026-10-08), Beta | B | wasmJs: Node; wasmWasi: Wasmtime / Node | host | unknown (wasmWasi is p1 sync) | host | unknown | [Kotlin stability](https://kotlinlang.org/docs/components-stability.html) |
| Scala.js (Wasm backend) | Scala | AOT→WasmGC + JS | 1.22.0 (2026-06-20) | B | JS host only | host | `js.await` (JSPI opt-in) | host | unknown | [Scala.js 1.22](https://www.scala-js.org/news/2026/06/20/announcing-scalajs-1.22.0/) |
| J2CL / J2Wasm; GraalVM Web Image | Java | AOT | v20261026 / experimental | B | V8 / Node 22+ | host | unknown | host | unknown | [J2CL](https://github.com/google/j2cl/blob/master/README.md) |
| CheerpJ | Java 8–21 | JVM in browser (interpreter + JIT→JS) | 5.0 (2026-10-30 / 11-02) | B (browser only) | none for Node / Rust | browser | unknown | browser | unknown | [CheerpJ 5.0](https://labs.leaningtech.com/blog/cheerpj-5.0) |
| JVM scripting (Groovy, BeanShell, JShell, .kts, Espresso) | various | JVM | Groovy 6.0.0 | A | JVM | none (JEP 486) | — | ambient | — | [JEP 486](https://openjdk.org/jeps/486) |
| SCI (JS build, in a V8 isolate) | Clojure | interpreter + `js/Function` JIT | 0.15.59 (2026-10-05) | B (isolate is the boundary) | Node / V8 | isolate limits + `:interrupt-fn` | Yes: `^:async` / await | host fetch | nbb ~1.2 MB, ~170 ms start | [SCI](https://github.com/babashka/sci) |
| SCI (JVM / native image) | Clojure | interpreter | 0.15.59 | B-cond (allowlist escapes 2025–26) | JVM | no memory cap; interrupt | sync | host | unknown | [SCI CHANGELOG](https://raw.githubusercontent.com/babashka/sci/master/CHANGELOG.md) |
| babashka / nbb | Clojure | SCI native binary / on Node | 1.12.218 / — | A | subprocess | OS | — | ambient | `bb -e 0` ~17 ms | [babashka](https://github.com/babashka/babashka) |
| scittle / squint / cherry | Clojure(Script) | SCI in browser; compilers to JS | — | B (in isolate) | JS | isolate | native JS async | host | unknown | [scittle](https://github.com/babashka/scittle) |
| Guile Hoot | Scheme | AOT→WasmGC + in-Wasm `(hoot eval)` | 0.9.0 (2026-05-13) | B | Node ≥22.3; not WASI | host | unknown (prompts) | host | unknown | [Hoot 0.9.0](https://spritely.institute/news/hoot-0-9-0-released.html) |
| Racket sandbox | Racket | native | — | A | subprocess | 30 MB / 30 s defaults | — | guarded | — | [Racket sandbox](https://docs.racket-lang.org/reference/Sandboxed_Evaluation.html) |
| Steel / ketos | Scheme / Lisp | Rust bytecode VMs | pre-1.0 / 0.11 | B-cond | Rust | undocumented | undocumented | — | unknown | [Steel](https://github.com/mattwparas/steel) |
| ECL | Common Lisp | C compiler + bytecode; Emscripten target | 26.3.27 (2026-03-27) | A native / B-cond Wasm | C | unknown | unknown | ambient (native) | unknown | [ECL](https://ecl.common-lisp.dev/posts/ECL-26327-release.html) |
| GHC Wasm backend | Haskell | AOT→wasm32-wasi + JSFFI | GHC 9.14.1, tech preview | B output / A compile | Node / browser (JSFFI); wasmtime (pure WASI) | host | Yes: async JSFFI suspends a green thread | host | unknown; pandoc TH build 16 min | [GHC wasm guide](https://ghc.gitlab.haskell.org/ghc/doc/users_guide/wasm.html) |
| MicroHs | Haskell | combinator runtime; Emscripten | 0.16.0.0 (2026-06-02) | B-cond | browser | none | unknown | host | unknown | [Hackage](https://hackage.haskell.org/package/MicroHs) |
| wasm_of_ocaml / js_of_ocaml (+ toplevel) | OCaml | bytecode→WasmGC / JS | 6.5.0 (2026-10-22) | B (toplevel compiles in-sandbox) | Node 22+; wasmtime (WASI) | host | effects via JSPI / CPS | host (none on WASI) | unknown | [js_of_ocaml releases](https://github.com/ocsigen/js_of_ocaml/releases) |
| AtomVM (Wasm) / Popcorn | Erlang / Elixir | C BEAM VM→Emscripten | 0.6.6 stable / Popcorn 1.0.x | B (immature) | Node / browser `.mjs` | unknown | JS handles; otherwise unknown | via JS | VM ~190 KB, >3 MB with libs | [AtomVM](https://github.com/atomvm/AtomVM) |
| Dune | Elixir | allowlisted eval on BEAM | 0.3.18 | B-cond | BEAM only | heap / reductions 30k; 50 ms | — | none | — | [Dune](https://dune.hexdocs.pm/readme.html) |
| Trealla (WASI) | Prolog | C interpreter→WASI | v3.15.10 (2026-11-13) | B | npm `trealla`; Go via wazero | time / inference limits | Yes: Promise yields query to host | `http_fetch/3`→host fetch | unknown | [trealla-js](https://github.com/guregu/trealla-js) |
| SWI-Prolog Wasm | Prolog | C VM→Emscripten | swipl-wasm 8.3.0 (2026-11-06) | B* (`:=`) | npm | unknown in Wasm | Yes: `await/2` | `fetch/3`→host | unknown | [SWI wasm manual](https://www.swi-prolog.org/pldoc/man?section=wasm) |
| Scryer Prolog | Prolog | Rust WAM | 0.10.0 (2026-10) | A native / B-cond Wasm | Rust crate | inference limit | undocumented | native `http_open` | unknown | [docs.rs](https://docs.rs/scryer-prolog/latest/scryer_prolog/) |
| Tcl safe interp | Tcl | C interpreter | 9.0.4 (2026-06-26) | B-cond (no memory limit) | C API | `interp limit` commands / time | unknown | socket hidden; host alias | unknown | [interp(n)](https://www.tcl-lang.org/man/tcl9.0/TclCmd/interp.html) |
| wacl / molt / Jim Tcl | Tcl | Emscripten / Rust / C | 2017 / 0.3.1 / 0.83 | B (stale) / B-cond / unknown | browser / Rust / C | — | — | — | — | [wacl](https://github.com/ecky-l/wacl) |
| just-bash | bash (simulated) | TS interpreter + ~80 utilities, virtual FS | 3.6.0 (2026-10-01) | B-cond (B inside an isolate) | Node ≥20.19; core runs in browser | count / byte caps, `maxExecutionTimeMs`; no heap cap | async `defineCommand`; executor turns APIs into commands | allowlisted curl | npm 2.6–3.7 MB | [just-bash README](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/README.md) |
| bashkit | bash (simulated) | Rust interpreter + 167 builtins, virtual FS | 0.21.0 (2026-11-11) | B-cond (B as Wasm) | Rust; Node via NAPI; Wasm package | 10K commands, loop caps, 100 MB FS | async `Builtin` trait | allowlisted curl; host HTTP transport | unknown | [bashkit README](https://raw.githubusercontent.com/everruns/bashkit/main/README.md) |
| Wasmer bash + coreutils (WASIX) | bash | real binaries→WASIX | Wasmer 7.5.0 (2026-10-01) | B-cond (Critical escape advisory) | Rust wasmer; `@wasmer/sdk` | Rust metering; JS none | unknown | WASIX sockets (`mode: 'host'`) | 0.1 ms sandbox creation (vendor) | [Wasmer advisories](https://github.com/wasmerio/wasmer/security/advisories) |
| uutils coreutils (wasip1 / p2) | Unix utilities | Rust→WASI | 0.12.0 (2026-09-17) | B | any WASI runtime | host | — | none | unknown | [uutils releases](https://github.com/uutils/coreutils/releases) |
| mvdan/sh interp / GoAWK | sh / AWK | Go interpreters | v3.14.1 / v1.32.0 | A (B-cond with all handlers replaced) / B-cond | Go only | ctx cancel | handlers / `Funcs` | none | unknown | [interp](https://pkg.go.dev/mvdan.cc/sh/v3/interp) |
| brush / Nushell | bash / nu | Rust, native | 0.5.0 / — | A | Rust | — | — | real network | — | [brush](https://raw.githubusercontent.com/reubeno/brush/main/README.md) |
| container2wasm / v86 / CheerpX / JSLinux | Linux userland | CPU emulation in Wasm | v0.5.0 / — / 1.0 / — | B (heavy) | wasmtime / wazero; browser | host | none | proxy / WebSocket | JSLinux ~100 MIPS (2017) | [container2wasm](https://github.com/container2wasm/container2wasm) |
| Native bash + srt / Codex sandbox | bash | native + bubblewrap / seccomp / Seatbelt | srt 0.0.83 | A | Node library (srt); Rust (Codex) | FS / network only | — | proxy allowlist | unknown | [srt](https://cdn.jsdelivr.net/gh/anthropics/sandbox-runtime/README.md) |
| DuckDB (native) | SQL | vectorized C++ | 2.0.0 LTS (2026-10-21) | A (vendor: "like Bash or Python") | Rust; Node (neo) | `memory_limit` (soft), threads; no timeout | — | httpfs (ambient) | unknown | [Securing DuckDB](https://duckdb.org/docs/2.0/operations_manual/securing_duckdb/overview.html) |
| DuckDB-Wasm | SQL | DuckDB→Wasm | docs: 2.0.0; README: based on 1.5.6 | B | npm; tested on Node | 4 GB (wasm32); single thread default | AsyncDuckDB in a Worker | JS httpfs range reads | ~36 MB raw / ~12 MB gz (third-party) | [duckdb-wasm](https://github.com/duckdb/duckdb-wasm) |
| SQLite (native, locked down) | SQL | C bytecode VM (VDBE) | 3.53.x (2026) | B-cond | rusqlite 0.42; `node:sqlite` (RC) | limits, progress handler, hard heap limit | — | none | small | [SQLite security](https://www.sqlite.org/security.html) |
| SQLite Wasm / wa-sqlite | SQL | SQLite→Wasm | — | B | npm | host | wa-sqlite Asyncify / JSPI builds | none | unknown | [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) |
| PGlite / pglite-oxide | Postgres SQL | Postgres→Wasm | 0.5.15 / 0.4.1 | B | npm (Node / Bun / Deno); Rust via Wasmer | unknown | single connection | none | ~3 MB gz (vendor) | [PGlite](https://github.com/electric-sql/pglite) |
| DataFusion | SQL | Rust vectorized engine | 55.2.0 | B-cond native / B Wasm subset | Rust; npm `datafusion-wasm` | MemoryPool; SQLOptions | — | object stores if registered | unknown | [docs.rs](https://docs.rs/datafusion/latest/datafusion/) |
| Polars | DataFrame / SQL | Rust | 1.33.1 in Pyodide | A (Python) / js-polars experimental | Rust; npm `@pola-rs/browser` | unknown | — | ambient (native) | large Wasm (unquantified) | [js-polars](https://github.com/pola-rs/js-polars) |
| chDB | SQL (ClickHouse) | embedded C++ | v4.4.0 (11 Sep; year inferred 2026) | A | Node, Go, Python; Rust (experimental) | readonly settings | — | `url()` / `s3()` / `file()` ambient | unknown | [chDB releases](https://github.com/chdb-io/chdb/releases) |

#### Cross-cutting Wasm platform facts that shape async and limits
- **JSPI is standardized.**
  - JS Promise Integration is at **Phase 5 ("The Feature is Standardized")**. Stack Switching is at Phase 3 — [WebAssembly/proposals](https://github.com/WebAssembly/proposals).
  - V8 says JSPI "is available in Chrome 137, and in Firefox 139" and estimates "the actual cost of a JSPI'd function is approximately 1μs" — [V8 blog](https://v8.dev/blog/jspi).
  - Node.js 25.0.0 (2025-10-15) ships V8 14.1 and lists "JSPI for WebAssembly". An explicit enable commit was reverted "as already enabled" — [Node 25.0.0](https://nodejs.org/en/blog/release/v25.0.0).
- **Finished Wasm proposals.** GC and tail calls (WG 2024-07-10); exception handling and Memory64 (WG 2025-07-23) — [finished proposals](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md).
- **WASI 0.3.** 0.3.0 shipped **2026-06-11** and 0.3.1 on 2026-08-11. It adds `async func`, `stream<T>` and `future<T>` to the Component Model. "WASI 0.3 support is available in Wasmtime 46 and later, which enables WASI 0.3 by default" — [wasi.dev roadmap](https://wasi.dev/roadmap).
- **Wasmtime controls.**
  - CPU: fuel is deterministic but "imposes more overhead … than epochs do"; epoch interruption "has been measured at around a 10% slowdown" — [Wasmtime docs](https://docs.wasmtime.dev/examples-interrupting-wasm.html).
  - Memory: `ResourceLimiter` gates `memory_growing` and `table_growing` (Wasmtime 50.0.1) — [docs.rs](https://docs.rs/wasmtime/latest/wasmtime/trait.ResourceLimiter.html).
  - Defaults: `async_stack_size` 2 MiB, `max_wasm_stack` 512 KiB, and 4 GiB of virtual reservation plus a 32 MiB guard per linear memory on 64-bit — [Config docs](https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html).
- **Pyodide already ships the data engines.** The Pyodide 314.0.7 package list includes duckdb 1.5.1, polars 1.33.1, pandas 3.0.2 and pyarrow 22.0.0 — [Pyodide packages](https://pyodide.org/en/stable/usage/packages-in-pyodide.html).
- **Many Emscripten language ports expose a JS-eval bridge to the guest by default:**

  | Port | Bridge |
  |---|---|
  | ruby.wasm | `evalJs: (code) => Function(code)()` — [vm.ts](https://raw.githubusercontent.com/ruby/ruby.wasm/main/packages/npm-packages/ruby-wasm-wasi/src/vm.ts) |
  | webR | `(0, eval)(code)` — [webr-worker.ts](https://raw.githubusercontent.com/r-wasm/webr/main/src/webR/webr-worker.ts) |
  | seanmorris php-wasm | Vrzno — [README](https://github.com/seanmorris/php-wasm) |
  | Trealla | `js_eval_json` — [trealla-js](https://github.com/guregu/trealla-js) |
  | SWI-Prolog | `js_run_script` "uses eval" — [npm-swipl-wasm](https://github.com/SWI-Prolog/npm-swipl-wasm) |

### Inferences
- **Async models for host tool calls, best to worst for "await many slow tools":**
  1. **Language-level suspension over host promises, no stack switching.** GHC async JSFFI green threads, SCI `^:async` (compiles to JS async functions), Trealla's Promise-yield, SWI `await/2`. A suspended guest costs only heap objects.
  2. **JSPI.** The @php-wasm JSPI build, wasm_of_ocaml's default effects mode, and Scala.js opt-in. About 1 µs per suspension (V8 estimate), on Node ≥25.
  3. **Asyncify.** ruby.wasm, zeroperl, TinyGo goroutines, the @php-wasm Asyncify build and wa-sqlite async. Works anywhere but costs code size and speed: Asyncify adds about 4 MB to a DuckDB build, and @php-wasm's auto-instrumentation raised boot to 4.5 s.
  4. **Synchronous imports** (WASI p1 Go/Kotlin/Swift, kobako service calls, Tcl aliases, SQLite UDFs). These need Wasmtime async fibers (2 MiB stack reserved per suspended call by default) or WASI 0.3 to avoid blocking a host thread.
  5. **Worker plus SharedArrayBuffer blocking** (webR `eval_js(await=TRUE)`). One blocked thread per suspended guest; worst for concurrency.
- **Memory.** Most language runtimes are 17–40 MB Wasm modules: ruby 32.6 MB, PHP 25.5 MB, Perl 25.4 MB, yaegi 39.8 MB, DuckDB ~36 MB, webR tarball 39.9 MB.
  - Compile each module once and share it (`WebAssembly.Module` in V8, `Module` in Wasmtime).
  - Marginal per-session RSS is then initial linear memory (webR and zeroperl start at 32 MB) plus engine state. That is the number the benchmark must measure, because no source publishes it.
- **Group B in practice means replacing the bridge.** Run these ports in a stripped isolate whose only globals are the tool shims, the same discipline Pyodide's `js` module needs. A port is only as safe as the host functions it is handed.
- **Recommended benchmark set:**
  - **Tier 1:** SCI-JS in the existing isolate; ruby.wasm (Node); kobako (Rust); just-bash (Node) and bashkit (Rust native and Wasm); DuckDB-Wasm, wa-sqlite (JSPI build) and PGlite, with Pyodide-DuckDB as a baseline; webR, for the data and plot use case.
  - **Tier 2, spot checks:** @php-wasm JSPI (if PHP matters; GPL), zeroperl, Trealla, wasm_of_ocaml toplevel, Guile Hoot `(hoot eval)`, .NET-Wasm with Roslyn, native SQLite locked down, DataFusion with SQLOptions, Tcl safe interp. GraalJS UNTRUSTED belongs here too, as a VM-level sandbox comparison point, but only via a JVM sidecar.

### Gaps
- No independent, conditions-stated per-instance RSS or cold-start measurement exists for any Wasm language runtime here (ruby.wasm, @php-wasm, zeroperl, webR, AtomVM, Hoot, Trealla, SWI, DuckDB-Wasm, PGlite). The benchmark will be the first source.
- Node 24 LTS default-JSPI status is not confirmed; Node 25 lists JSPI.
- Several long-tail facts rest on search-result summaries because the web-search budget ran out (marked in sections).

## Ruby, PHP and Perl (ruby.wasm, mruby/mruby/c, kobako, Artichoke; php-wasm, Wasm Labs PHP; WebPerl, zeroperl)

### Takeaway
All three languages have a working Group B path through Wasm.

- **Ruby:** ruby.wasm, CRuby 3.2 to 4.0 compiled to WASI or Emscripten; host promises are awaited through Asyncify-backed Fibers. For Rust hosts, **kobako** runs mruby inside wasmtime in-process and is built for LLM-generated code.
- **PHP:** @php-wasm from WordPress Playground, PHP 7.4 to 8.5, with JSPI and Asyncify builds. It is **GPL-2.0-or-later** and has no CPU or memory API.
- **Perl:** zeroperl, Perl 5.42 as a WASI reactor whose host functions may return Promises; still experimental.

**These are Wasm modules of roughly 25–33 MB.** The Emscripten-style JS bridges in ruby.wasm (`JS.eval` → `Function(code)()`) and seanmorris php-wasm (Vrzno) give the guest the host JS realm's full authority, so the bridge must be replaced or confined to a stripped isolate.

Native CRuby, PHP and Perl are Group A by their maintainers' own statements: `$SAFE` was removed, `open_basedir`/`disable_functions` bypasses are not security bugs, and Safe.pm is "not supported as a security mechanism". Native mruby is B-conditional in principle but A in practice: Debian tracks 43 CVEs, and Shopify's bounty forced a separate seccomp process.

### Cited Findings

#### ruby.wasm (CRuby → Wasm)
- **(1) Versions.**
  - npm `@ruby/wasm-wasi`, `@ruby/4.0-wasm-wasi` and `@ruby/3.4-wasm-wasi` are at **2.10.1 (2026-08-01)**, with daily snapshots up to 2026-11-13 — [npm](https://registry.npmjs.org/@ruby%2F4.0-wasm-wasi), [releases](https://github.com/ruby/ruby.wasm/releases).
  - Ruby 4.0.0, 3.4, 3.3, 3.2 and head are built. MIT. Last push 2026-11-13 — [GitHub API](https://api.github.com/repos/ruby/ruby.wasm).
  - Cross-built with WASI SDK and Binaryen — [CRuby wasm README](https://raw.githubusercontent.com/ruby/ruby/master/wasm/README.md).
- **(2) Group B for the module, with a bridge caveat.**
  - "There is no support for networking" and there is no `Thread` — [ruby.wasm docs](https://ruby.github.io/ruby.wasm/). `Kernel.spawn` and `system` are unsupported — [CRuby wasm README](https://raw.githubusercontent.com/ruby/ruby/master/wasm/README.md).
  - The `js` bridge's imports include `evalJs: (code) => Function(code)()` and `globalThis` — [vm.ts](https://raw.githubusercontent.com/ruby/ruby.wasm/main/packages/npm-packages/ruby-wasm-wasi/src/vm.ts).
  - No ruby.wasm CVEs were found.
- **(3) Embedding.**
  - JS API: `RubyVM.instantiateModule`, `vm.eval`, `vm.evalAsync`, and `instantiateComponent` via jco — [vm.ts](https://raw.githubusercontent.com/ruby/ruby.wasm/main/packages/npm-packages/ruby-wasm-wasi/src/vm.ts).
  - Runtimes: "Node.js, browsers with polyfill, wasmtime". `rbwasm pack` bundles an app — [README](https://github.com/ruby/ruby.wasm).
  - A WASI p2 component exists only as a head-release asset — [release API](https://api.github.com/repos/ruby/ruby.wasm/releases?per_page=1).
- **(4) Limits.** None are built in. The README suggests `-zstack-size` around 16 MiB to avoid out-of-bounds stack errors — [CRuby wasm README](https://raw.githubusercontent.com/ruby/ruby/master/wasm/README.md).
- **(5) Async.**
  - CRuby's Wasm port uses Binaryen Asyncify for fibers, setjmp and longjmp — [asyncify.h](https://raw.githubusercontent.com/ruby/ruby/master/wasm/asyncify.h).
  - `JS::Object#await` parks the current Fiber and resumes it from the promise's `then`. It works only under `evalAsync` / `callAsync` — [js.rb](https://raw.githubusercontent.com/ruby/ruby.wasm/main/packages/gems/js/lib/js.rb).
  - Nested JS→Ruby→JS→Ruby frames can't switch fibers, because "Asyncify cannot scan the Wasm stack above the JS frame" — [vm.ts](https://raw.githubusercontent.com/ruby/ruby.wasm/main/packages/npm-packages/ruby-wasm-wasi/src/vm.ts).
  - Values cross as handles (`JS::Object`), not serialized data.
- **(6) HTTP.** Only through the host's fetch: `JS.global.fetch(url).await` — [cheat sheet](https://github.com/ruby/ruby.wasm/blob/main/docs/cheat_sheet.md).
- **(7) Footprint.**
  - Files: `ruby+stdlib.wasm` is **32,555,374 B**; `ruby.wasm` without stdlib is 17,219,023 B — [npm tarball](https://registry.npmjs.org/@ruby/4.0-wasm-wasi/-/4.0-wasm-wasi-2.10.1.tgz). The 4.0 `wasip1-minimal` build is 24.5 MB — [release API](https://api.github.com/repos/ruby/ruby.wasm/releases?per_page=1).
  - Startup: the first run in wasmtime can take "~20 sec" to JIT-compile — [CRuby wasm README](https://raw.githubusercontent.com/ruby/ruby/master/wasm/README.md). Fermyon calls the interpreter "large and slow to start" — [Fermyon](https://developer.fermyon.com/wasm-languages/ruby).
  - Per-instance RSS: unknown.
- **(9) Snapshot.** None built in. Shopify's Ruvy (a Wizer-pre-initialized CRuby) is archived — [Fermyon](https://developer.fermyon.com/wasm-languages/ruby), [GitHub API](https://api.github.com/repos/Shopify/ruvy).
- **(10) Ecosystem.** The "full" profile "includes all standard extension libraries" — [README](https://github.com/ruby/ruby.wasm). "Gems without C code can be used" — [Fermyon](https://developer.fermyon.com/wasm-languages/ruby).

#### kobako (mruby inside wasmtime, for LLM-generated code)
- **What it is.**
  - Runs untrusted mruby "in an in-process Wasm sandbox: LLM-generated code, user formulas, student submissions, plugins".
  - Promise: "A script reaches no host memory, file, network, or credential you did not hand it."
  - Source: [kobako README](https://github.com/elct9620/kobako).
- **Versions.** Gem 0.30.0 (2026-11-07) — [RubyGems](https://rubygems.org/api/v1/gems/kobako.json). Crates `kobako` / `kobako-wasmtime` 0.20.0 — [crates.io](https://crates.io/api/v1/crates/kobako-wasmtime). Apache-2.0.
- **Defaults** — [README](https://github.com/elct9620/kobako):
  - Limits: 60 s timeout, 4 MiB memory, 1 MiB stdout/stderr, 6 connections.
  - Networking: guest `Net::HTTP` reaches only named endpoints, with method and path rules. The host injects credentials.
  - Host calls: synchronous service calls.
- **Vendor figures, macOS arm64:** first `Sandbox.new` about 500 ms, later ones about 3 µs; a warm eval with one service call about 62 µs — [README](https://github.com/elct9620/kobako). Young project (17 stars).

#### mruby (native C), mruby/c, and Shopify Scripts
- **(1) Versions.**
  - mruby 4.0.0 (2026-04-20) added pattern matching, object shapes and `mruby-task`, and switched Emscripten builds to native Wasm EH — [release](https://mruby.org/releases/2026/04/20/mruby-4.0.0-released.html).
  - A 4.1.0-rc2 tag points at a commit dated 2026-09-11 — [GitHub API](https://api.github.com/repos/mruby/mruby/commits/4.1.0-rc2). MIT.
  - mruby/c release4.0.0 (2026-06-12) targets microcontrollers — [mruby/c](https://github.com/mrubyc/mrubyc).
- **(2) Capabilities.** The core has no I/O, **but `default.gembox` includes `stdlib-io`**: mruby-io, mruby-socket, mruby-dir, mruby-env and mruby-process — [stdlib-io.gembox](https://raw.githubusercontent.com/mruby/mruby/master/mrbgems/stdlib-io.gembox).
- **(2) Security record.**
  - Debian tracks **43 CVEs (4 open)**, mostly use-after-free and heap overflows, including CVE-2026-79590 in 4.0.0 — [Debian tracker](https://security-tracker.debian.org/tracker/source-package/mruby).
  - Shopify's mruby bounty launched 2016-11-07: $20k for infra compromise, $500 for a resource-limit bypass — [firebounty](https://firebounty.com/71-shopify-scripts).
  - About $450k had been paid by 2016-12-09, when Shopify added "seccomp-bpf sandboxing and process isolation" — [brandur 2017](https://brandur.org/fragments/shopify-mruby).
- **(4) Limits.**
  - `mrb_open_allocf()` was removed. The allocator is overridden at link time (`mrb_basic_alloc_func`) with no per-state parameter — [memory guide](https://raw.githubusercontent.com/mruby/mruby/master/doc/guides/memory.md).
  - `MRB_USE_DEBUG_HOOK` adds a per-instruction `code_fetch_hook`, and `MRB_STACK_MAX` caps the stack — [mrbconf](https://raw.githubusercontent.com/mruby/mruby/master/doc/guides/mrbconf.md).
- **(3) Embedding.** Rust: beni 0.27.0 (2026-11-11) — [crates.io](https://crates.io/api/v1/crates/beni). Node: none maintained; npm `mruby` dates from 2012 — [npm](https://registry.npmjs.org/mruby).
- **(7) Footprint.** mruby "< 400KB" RAM, mruby/c "< 40KB" (vendor) — [mruby/c](https://github.com/mrubyc/mrubyc). A fork reports "~300k at least per process" and 3–5 ms runs — [script_core](https://www.rubydoc.info/gems/script_core/0.0.2).
- **(11) Shopify Scripts.**
  - Sandboxing: ESS ran mruby in a separate process that "uses seccomp to sandbox itself", taking msgpack on stdin, with a 1 s and 100k-instruction default quota — [Shopify/ess](https://github.com/Shopify/ess).
  - Retired 2026-06-30 — [Shopify help](https://help.shopify.com/en/manual/checkout-settings/script-editor/migrating).
  - Replaced by Wasm Functions. In 2020 Lucet startup was 35 µs and execution under 5 ms — [Shopify engineering](https://shopify.engineering/shopify-webassembly). Functions are capped at 11M instructions and a 256 KiB binary — [shopify.dev](https://shopify.dev/docs/apps/build/functions/optimize-instruction-counts).

#### Other Ruby runtimes
- **SabiRuby 0.9.0:** a pure-Rust `no_std` VM for mruby 4.1 bytecode that can target Wasm. It steps under an instruction budget (`Vm::step`), exposes Rust functions via `Vm::define_fn`, and uses `regex-automata` (no backreferences). B-conditional, very new — [README](https://raw.githubusercontent.com/sabiruby/sabiruby/main/README.md), [crates.io](https://crates.io/api/v1/crates/sabiruby).
- **mruby/edge 2.1.2 (2026-10-16):** a Rust mruby VM for Wasm; B-conditional — [mrubyedge](https://github.com/mrubyedge/mrubyedge).
- **Artichoke:** Ruby in Rust, aimed at "untrusted environments", **archived 2025-11-03** — [artichoke](https://github.com/artichoke/artichoke).
- **Opal v1.8.3 (2026-05-01):** compiles Ruby to JS; B inside an isolate — [Opal API](https://api.github.com/repos/opal/opal/releases?per_page=3).
- **Older Wasm builds:**
  - Wasmer `katei/ruby` (2022) and VMware Wasm Labs Ruby 3.2.2 (2023), both possibly stale — [Wasmer registry](https://registry.wasmer.io/graphql).
  - Also listed: run.rb, Wruby, rlang, cry-wasm — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).
- **Native, Group A:**
  - TruffleRuby graal-40.0.0 (TRUSTED only) — [GraalVM sandboxing](https://www.graalvm.org/latest/security-guide/sandboxing/).
  - JRuby 10.1.3.0, Natalie, and the magnus / rb-sys bindings.
- **Native CRuby: A.** "$SAFE is now a normal global variable with no special behavior" (Ruby 3.0) — [NEWS](https://docs.ruby-lang.org/en/3.0.0/NEWS_md.html).

#### @php-wasm (WordPress Playground)
- **(1) Versions.**
  - JSPI and Asyncify builds for **PHP 7.4 to 8.5** — [Playground docs](https://developer.wordpress.org/playground/developers/architecture/wasm-asyncify/).
  - `@php-wasm/node`, `/web` and `/universal` are at **3.1.64 (2026-11-10)**, **GPL-2.0-or-later**, and require Node ≥24.18.0 — [npm](https://registry.npmjs.org/@php-wasm%2Fnode).
  - Released roughly weekly — [GitHub API](https://api.github.com/repos/WordPress/wordpress-playground/releases?per_page=3).
- **(2) Group B, depending on what the host wires up.**
  - PHP "starts with an in-memory filesystem". Networking works only "if you plug in a custom WebSocket-to-TCP proxy" — [php-wasm/node docs](https://developer.wordpress.org/playground/developers/local-development/php-wasm-node).
  - Process spawning goes only through `setSpawnHandler` — [universal d.ts](https://registry.npmjs.org/@php-wasm/universal/-/universal-3.1.64.tgz).
  - PHP reaches JS only via `post_message_to_js(string)` — [API docs](https://developer.wordpress.org/playground/developers/apis/javascript-api/playground-api-client/).
- **(3) Embedding.** Node and browser only, via the Emscripten JS glue: `new PHP(await loadNodeRuntime('8.3'))`, `php.runStream({code})` — [docs](https://developer.wordpress.org/playground/developers/local-development/php-wasm-node).
- **(4) Limits.**
  - No CPU or memory API.
  - `enableRuntimeRotation({maxRequests})` and `hotSwapPHPRuntime` replace runtimes — [d.ts](https://registry.npmjs.org/@php-wasm/universal/-/universal-3.1.64.tgz).
  - "Creating a new PHP instance is expensive" — [docs](https://developer.wordpress.org/playground/developers/local-development/php-wasm-node).
- **(5) Async** — [Asyncify vs JSPI docs](https://developer.wordpress.org/playground/developers/architecture/wasm-asyncify/):
  - Asyncify "saves the entire C call stack" and needs a hand-kept `ASYNCIFY_ONLY` list. Auto-detecting it finds about 70,000 functions and raises boot to 4.5 s, and a function missing from the list crashes the module.
  - JSPI switches stacks natively in V8. Node 23+ has it; the page's wording on Node 22/24 flags is inconsistent.
  - External extensions require JSPI.
  - The listener type allows a Promise return (`MessageListener = (data: string) => Promise<string | Uint8Array | void> | …`) — [d.ts](https://registry.npmjs.org/@php-wasm/universal/-/universal-3.1.64.tgz).
- **(6) HTTP.**
  - Node: "a WebSocket to TCP socket proxy, Asyncify, and patching deep PHP internals like php_select".
  - Browser: `wp_safe_remote_get` maps to `fetch()`, plus a slower path that parses PHP's TLS traffic and reissues it as `fetch()`.
  - Source: [architecture overview](https://developer.wordpress.org/playground/developers/architecture/wasm-php-overview/).
- **(7) Footprint.**
  - `php_8_4.wasm` is **25,520,951 B (JSPI) / 25,450,716 B (Asyncify)**; `intl.so` is 5.6 MB (JSPI) / 7.9 MB (Asyncify) — [tarball](https://registry.npmjs.org/@php-wasm/node-8-4/-/node-8-4-3.1.64.tgz).
  - A 2026-03-11 post reports PHP 8.4 going from about 27 MB to about 23 MB with `MAIN_MODULE=2`, which conflicts with the tarball — [Make WordPress](https://make.wordpress.org/playground/2026/03/11/how-wordpress-playground-cut-php-wasm-binary-sizes-by-122-mb/).
  - Boot time and memory benchmarks are "the next step" (not yet published).
- **(10) Ecosystem.** Extensions: intl, xdebug, redis, memcached, plus external extension loading — [docs](https://developer.wordpress.org/playground/developers/local-development/php-wasm-node). The Node build can "install composer packages" — [overview](https://developer.wordpress.org/playground/developers/architecture/wasm-php-overview/).
- **(11) Users:** WordPress Playground.

#### Other PHP runtimes
- **seanmorris php-wasm 0.2.0 (2026-10-01).**
  - PHP 8.0–8.5, with loadable gd, iconv, intl, libxml, dom, yaml, zip, mbstring, openssl, phar, sqlite, tidy and zlib.
  - Licensed "(Apache-2.0 OR GPL-2.0-only)" — [npm](https://registry.npmjs.org/php-wasm).
  - **Vrzno** (`vrzno_eval`, `$window->fetch`) exposes the JS realm to PHP — [README](https://github.com/seanmorris/php-wasm).
- **Wasmer `php/php` 8.3.403 (2025-01-14)** is a WASIX build with OpenSSL and ICU deps — [wasmer.io](https://wasmer.io/php/php). Crate `wasmer-wasix` 0.705.0 — [crates.io](https://crates.io/api/v1/crates/wasmer-wasix).
- **VMware Wasm Labs:** the last PHP release is `php/8.2.6+20230714` (**possibly stale, 2023**) — [releases API](https://api.github.com/repos/vmware-labs/webassembly-language-runtimes/releases?per_page=100).
- **Also listed:** PIB / oraoto/pib (2022) — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).
- **Native, Group A:**
  - PeachPie v1.1.13.
  - HHVM is Hack-only since v4.0 — [hhvm.com](https://hhvm.com/blog/2018/09/12/end-of-php-support-future-of-hack.html).
  - Rust PHP reimplementations: phprs, phplang — [crates.io](https://crates.io/api/v1/crates/phprs).
- **Native PHP: A.** PHP's security classification lists "requires an open_basedir bypass" as not a security issue — [php/policies](https://github.com/php/policies/blob/main/security-classification.rst). `disable_functions` bypasses are likewise rejected — [externals](https://externals.io/message/131161).

#### zeroperl and zeroperl-ts (Perl 5.42 → WASI)
- **(1) Versions and build.**
  - Default Perl 5.42.0. Builds produce `zeroperl.wasm` (a reactor with Asyncify) and a variant without it.
  - Defaults: `INITIAL_MEMORY` 32 MiB, `STACK_SIZE` 8 MiB, ExifTool bundled.
  - "Experimental", MIT, last push 2026-04-13 — [zeroperl](https://github.com/6over3/zeroperl).
  - zeroperl-ts 1.0.10 (2025-12-05), Apache-2.0 — [npm](https://registry.npmjs.org/@6over3%2Fzeroperl-ts).
- **(2) B, experimental.**
  - Bundled files come from an in-memory VFS. Other paths need WASI preopens, and network modules were pruned — [part 1](https://andrews.substack.com/p/zeroperl-sandboxed-perl-with-webassembly).
  - After switching to Asyncify-based setjmp, it runs in "Wasmer, Wasmtime, and every other WebAssembly runtime I tested" — [part 2](https://andrews.substack.com/p/get-in-loser-were-rewinding-the-stack).
- **(3)/(5) Embedding and async.**
  - API: `ZeroPerl.create`, `eval`, `call`, `registerFunction`, `MemoryFileSystem`, on Node, Bun, Deno and the browser — [zeroperl-ts](https://github.com/6over3/zeroperl-ts).
  - A host function may be "sync or async", returning `PerlValue | Promise<PerlValue>`. Marshaling uses a handle-based C API — [tarball](https://registry.npmjs.org/@6over3/zeroperl-ts/-/zeroperl-ts-1.0.10.tgz).
- **(7) Footprint.** `zeroperl.wasm` is **25,358,252 B** — [tarball](https://registry.npmjs.org/@6over3/zeroperl-ts/-/zeroperl-ts-1.0.10.tgz). An earlier February 2025 trimmed build was 9.1 MB — [part 1](https://andrews.substack.com/p/zeroperl-sandboxed-perl-with-webassembly).
- **Limits and HTTP.** No runtime limit API, only `reset()`/`dispose()`. No HTTP beyond host functions.

#### Other Perl runtimes
- **WebPerl:** browser only, "very much in beta" at v0.09-beta — [site](https://webperl.zero-g.net/). Last push 2023-03-27 (possibly stale) — [GitHub API](https://api.github.com/repos/haukex/webperl). Fermyon calls it "stagnant" — [Fermyon](https://developer.fermyon.com/wasm-languages/perl).
- **Native Perl / Safe.pm: A.**
  - "Opcode restrictions and Safe compartments are not supported as security mechanisms" — [perlsecpolicy](https://perldoc.perl.org/perlsecpolicy).
  - Safe 2.47 "does not implement an effective sandbox" — [Safe](https://perldoc.perl.org/Safe).
- **Other implementations (Group A):**
  - PerlOnJava v5.44.1 (JVM) — [PerlOnJava](https://github.com/fglock/PerlOnJava).
  - strykelang 0.17.62 (Rust Perl interpreter with a Cranelift JIT) — [README](https://raw.githubusercontent.com/MenkeTechnologies/strykelang/main/README.md).

### Inferences
- **Benchmark ruby.wasm (Node) and kobako (Rust) as the Ruby pair.**
  - ruby.wasm's Asyncify Fiber model lets one guest await many host promises (`Promise.all(...).await`). Its 32 MB module should be compiled once and shared.
  - kobako's vendor-claimed 3 µs warm instance creation makes it the most interesting per-session-cost data point among the non-JS runtimes.
- **@php-wasm is benchmarkable but has three disqualifiers for embedding in a commercial product:** GPL licensing, no limit API, and its "expensive" instance creation.
- **zeroperl's async host functions make it a viable Perl data point**, mainly for regex and text processing.
- **Across Emscripten ports, the host-call surface is the security boundary.** The ports have the same shape as Pyodide's `js` module, so the same hardening recipe applies.

### Gaps
- No published per-instance RSS, cold-start or speed benchmarks for ruby.wasm, @php-wasm, zeroperl or kobako (kobako's numbers are vendor figures).
- How @php-wasm enforces CPU and memory limits.
- Whether kobako uses wasmtime fuel or epochs.
- The year of the Shopify bounty figures is from a 2017 secondary source.

## R (webR) and Julia

### Takeaway
**webR** is the only serious agent-grade option among R and Julia. It runs R 4.6.0 compiled to Wasm and gives access to about 24.6k packages, including dplyr, data.table, duckdb, ggplot2, readxl/writexl/openxlsx, pdftools, magick, officer and httr2. It is **B-conditional, not clean B**, for three reasons:
- Guest R can `eval_js` arbitrary JS in the worker's global scope.
- Under Node its XHR shim can read `file:` URLs and spawns a child process per request.
- It has no memory cap and only a cooperative interrupt.

Its host-call model fits code mode poorly. R calls host tools only by evaluating JS strings, and `await=TRUE` blocks the whole worker through SharedArrayBuffer and `Atomics.wait` instead of using JSPI or Asyncify, so every suspended guest holds a thread plus at least 32 MB of linear memory.

**Julia has no sandboxable dynamic path**:
- Native Julia, including juliac/JuliaC, is Group A.
- The Wasm compilers (WasmTarget.jl, WebAssemblyCompiler.jl) handle only type-stable subsets and need a native Julia compile step.

### Cited Findings

#### webR (R on Wasm)
- **(1) Identity**
  - R compiled to WebAssembly with Emscripten "for use in web browsers and Node" — [GitHub API](https://api.github.com/repos/r-wasm/webr). Fortran is built through patched LLVM Flang — [v0.6.0](https://github.com/r-wasm/webr/releases/tag/v0.6.0).
  - Linked `MAIN_MODULE=1` with packages as `SIDE_MODULE`s and `SUPPORT_LONGJMP=wasm` — [R/Makefile](https://raw.githubusercontent.com/r-wasm/webr/main/R/Makefile). The default env sets `R_ENABLE_JIT: 0` — [WebROptions](https://docs.r-wasm.org/webr/latest/api/js/interfaces/WebR.WebROptions.html).
  - Versions:
    - **0.6.1, 2026-11-10** (adds `downloadTimeout`) — [releases](https://github.com/r-wasm/webr/releases), [npm](https://registry.npmjs.org/webr).
    - **0.6.0, 2026-05-19**, on R 4.6.0. It breaks binary compatibility with packages built for earlier versions — [v0.6.0](https://github.com/r-wasm/webr/releases/tag/v0.6.0).
    - Emscripten version conflict: the release note says 4.0.8, while [Posit's post (2026-06-18)](https://opensource.posit.co/blog/2026-06-18_webr-0-6-0/) says 5.0.7.
  - License: binaries are GPL-3; build scripts and the REPL are MIT — [LICENSE.md](https://raw.githubusercontent.com/r-wasm/webr/main/LICENSE.md).
- **(2) Group: B-conditional (effectively A under a plain Node host)**
  - `webr::eval_js()` reaches `globalThis.Module.webr.evalJs`, which runs `(0, eval)(code)` in the worker's global scope. With `await=TRUE` the code runs on the **main thread** — [eval.R](https://raw.githubusercontent.com/r-wasm/webr/main/packages/webr/R/eval.R), [webr.c](https://raw.githubusercontent.com/r-wasm/webr/main/packages/webr/src/webr.c), [webr-worker.ts](https://raw.githubusercontent.com/r-wasm/webr/main/src/webR/webr-worker.ts), [R API](https://docs.r-wasm.org/webr/latest/api/r.html).
  - Under Node the worker installs `xmlhttprequest-ssl` as `XMLHttpRequest`, and that library defaults to `allowFileSystemResources: true` — [webr-worker.ts](https://raw.githubusercontent.com/r-wasm/webr/main/src/webR/webr-worker.ts), [xmlhttprequest-ssl](https://unpkg.com/xmlhttprequest-ssl/lib/XMLHttpRequest.js).
  - A webR-based CLI warns: "The Node.js runtime does not provide a sandboxed environment. It should only be used with trusted code" — [@henrikbengtsson/rw](https://www.pkgstats.com/pkg:@henrikbengtsson/rw).
  - No CVEs, fuzzing or security audits found.
- **(3) Embedding**
  - npm `webr` 0.6.1 is 49,462,319 bytes unpacked — [npm](https://registry.npmjs.org/webr).
  - Runs in Node through worker_threads, and in browsers.
  - Mounts: workerfs, nodefs (Node only), drivefs and idbfs — [R API](https://docs.r-wasm.org/webr/latest/api/r.html).
  - No Rust crate.
- **(4) Limits**
  - Memory: `INITIAL_MEMORY=32MB`, `ALLOW_MEMORY_GROWTH=1`, `STACK_SIZE=1MB`. There is no `MAXIMUM_MEMORY` flag and no memory option at runtime — [R/Makefile](https://raw.githubusercontent.com/r-wasm/webr/main/R/Makefile), [WebROptions](https://docs.r-wasm.org/webr/latest/api/js/interfaces/WebR.WebROptions.html).
  - CPU: `interrupt()` is cooperative. It polls a SharedArrayBuffer (SAB) event buffer during 50 ms `Atomics.wait` slices — [channel-shared.ts](https://raw.githubusercontent.com/r-wasm/webr/main/src/webR/chan/channel-shared.ts). On the PostMessage channel "R code cannot be interrupted" — [communication](https://docs.r-wasm.org/webr/latest/communication.html).
  - No fuel and no evaluation timeout. The hard stop is killing the worker.
- **(5) Host calls and async**
  - JS→R: `evalR`, `evalRRaw` and `captureR` return Promises. RObject proxies need to be destroyed or held in a `Shelter` — [evaluating](https://docs.r-wasm.org/webr/latest/evaluating.html).
  - R→JS: only `eval_js(code, await)`, marked "experimental". `await=TRUE` arrived in 0.5.5 — [R API](https://docs.r-wasm.org/webr/latest/api/r.html), [NEWS](https://github.com/r-wasm/webr/blob/main/NEWS.md).
    - It is implemented as a `syncRequest`, so the worker blocks until the main-thread promise settles.
    - It throws on the PostMessage channel — [channel-postmessage.ts](https://raw.githubusercontent.com/r-wasm/webr/main/src/webR/chan/channel-postmessage.ts).
  - Channels: SAB is the default when the page is cross-origin isolated, with PostMessage as the fallback. The ServiceWorker channel was removed in 0.5.5 — [communication](https://docs.r-wasm.org/webr/latest/communication.html).
  - Marshaling: JS values pass through `RObject` constructors. Data frames are the default conversion since 0.5.4 — [tidyverse blog](https://tidyverse.org/blog/2025/07/webr-0-5-4/). Cost unknown.
- **(6) HTTP**
  - `download.file` uses a **synchronous XHR GET**: simple GETs only, and browsers need CORS — [networking](https://docs.r-wasm.org/webr/latest/networking.html). In Node, each sync XHR spawns a **child Node process** — [xmlhttprequest-ssl](https://unpkg.com/xmlhttprequest-ssl/lib/XMLHttpRequest.js).
  - curl/httr2 work through Emscripten socket emulation over WebSocket, which needs an external WebSocket→TCP/SOCKS proxy — [networking](https://docs.r-wasm.org/webr/latest/networking.html), [0.6.0 post](https://opensource.posit.co/blog/2026-06-18_webr-0-6-0/).
- **(7) Footprint**
  - Release tarball 39,868,123 bytes — [release API](https://api.github.com/repos/r-wasm/webr/releases/latest).
  - Initial page download about 20–30 MB — [Appsilon](https://appsilon.com/bringing-webr-into-shiny/) (possibly stale, 2023).
  - The filesystem loads lazily since 0.2.0 — [NEWS](https://github.com/r-wasm/webr/blob/main/NEWS.md).
  - Per-instance RSS and cold start: **unknown**. One Node server recommends 4 GB+ RAM and reports first startup with packages taking "several minutes" (anecdotal) — [mimilabs/webr](https://github.com/mimilabs/webr).
- **(8) Speed:** no published benchmarks. R's JIT is off by default.
- **(9) Snapshot:** none. idbfs `syncfs()` persists files only.
- **(10) Ecosystem**
  - **24,640 entries** in the R 4.6 index, 23,559 for R 4.5 — [PACKAGES 4.6](https://repo.r-wasm.org/bin/emscripten/contrib/4.6/PACKAGES), [PACKAGES 4.5](https://repo.r-wasm.org/bin/emscripten/contrib/4.5/PACKAGES).
  - Listed:

    | Area | Packages |
    |---|---|
    | Data | dplyr 1.2.1, data.table 1.18.6.1, duckdb 1.5.6, RSQLite |
    | Charts | ggplot2 4.0.3, plotly, svglite, ragg |
    | Images and PDF | magick 2.9.1, pdftools 3.9.1, qpdf |
    | Office | officer, flextable |
    | JSON and dates | jsonlite 2.0.0, lubridate |
    | Spreadsheets | readxl 1.5.0.1, writexl 2.0.1, openxlsx 4.2.9 |
    | HTTP and scraping | httr 1.4.9, httr2 1.3.0, curl 8.0.0, rvest |
    | Crypto and compression | openssl, digest, zip |
    | Missing | **arrow** |

  - Being listed does not mean a package is verified to work.
  - Graphics: a `canvas()` device on OffscreenCanvas, plus Cairo `png()`/`svg()`. `captureR` captures plots — [R API](https://docs.r-wasm.org/webr/latest/api/r.html), [NEWS](https://github.com/r-wasm/webr/blob/main/NEWS.md).
  - Packages install at runtime through `webr::install` or filesystem-image mounts — [packages](https://docs.r-wasm.org/webr/latest/packages.html).
- **(11) Users:** Quarto Live and Shinylive ([Posit](https://opensource.posit.co/blog/2026-06-18_webr-0-6-0/)), and the JupyterLite kernel ([tidyverse](https://tidyverse.org/blog/2025/07/webr-0-5-4/)). All run the user's own code client-side. No server-side multi-tenant use was found.

#### Native R (Group A)
- `unix` 1.6.0 (2026-04-23): `eval_safe()` forks a child with `timeout`, `rlimits`, root-only `uid`/`gid` and an AppArmor `profile` (Debian/Ubuntu) — [CRAN](https://cran.r-project.org/package=unix), [refman](https://cran.r-project.org/web/packages/unix/refman/unix.html).
- The package presents this as isolation from session side effects, not a security sandbox. `RLIMIT_AS` does not work on macOS (same source).

#### Julia
- **Native (A).** 1.13 was released 2026-09-10.
  - Startup is 56.7 ms vs 69.1 ms in 1.12 (hyperfine, `--startup-file=no -e ''`).
  - Precompilation is about 30% faster.
  - Source: [Julia 1.13 highlights](https://julialang.org/blog/2026/09/julia-1.13-highlights/). Empty-process RSS is unknown.
  - Malt.jl gives a process per Pluto notebook. That is process isolation, not a sandbox — [Discourse](https://discourse.julialang.org/t/ann-malt-jl-distributed-alternative-used-internally-by-pluto/108401).
- **juliac / JuliaC.jl (A).**
  - Experimental `--trim` arrived in 1.12, and juliac became the JuliaC.jl package in 1.13 — [1.13 highlights](https://julialang.org/blog/2026/09/julia-1.13-highlights/).
  - One report: a 1.7 MB binary plus 92 MB of libraries with `--trim=safe` — [Discourse](https://discourse.julialang.org/t/is-it-normal-for-juliac-to-still-produce-280-mb-of-libraries-for-a-println-example/133140).
  - No official Wasm target as of July 2026 — [Discourse](https://discourse.julialang.org/t/julia-as-a-backend-language-in-r-python-and-browsers-wasm/138155).
- **WasmTarget.jl (output B, compile step A).** Compiles typed IR to WasmGC with "no runtime, no LLVM", runs in the browser and Node, has 2,500+ tests per Julia version, and wasm-opt cuts size by about 85% — [docs](https://grouptherapyorg.github.io/WasmTarget.jl/). Version and license unknown.
- **WebAssemblyCompiler.jl.** "Experimental": type-stable code only, with no exceptions, Unions or BLAS. Docs were built with Julia 1.9.4 on 2023-11-26 (possibly stale) — [docs](https://tshort.github.io/WebAssemblyCompiler.jl/stable/). MIT — [repo](https://github.com/tshort/WebAssemblyCompiler.jl).
- **StaticCompiler.jl:** native output only — [repo](https://github.com/tshort/StaticCompiler.jl).
- **Older experiments:**
  - julia-wasm (Keno): "extremely early alpha" — [repo](https://github.com/Keno/julia-wasm).
  - Charlotte.jl: unmaintained — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).
  - Whisk.jl and WitBindgen.jl: experiments — [Discourse](https://discourse.julialang.org/t/julia-as-a-backend-language-in-r-python-and-browsers-wasm/138155), [FOSS United](https://fossunited.org/hack/fosshack26/p/cqseab3doe).

### Inferences
- **webR needs the same lockdown as Pyodide's `js` module, or stricter.**
  - Run it in a V8 isolate or worker whose globals expose only tool shims.
  - Replace `Module.webr.evalJs`, `XMLHttpRequest` and `WebSocket`. Removing the R wrapper is not enough, because `.Call` stays reachable.
- **To fan out tool calls from R**, a single `eval_js("Promise.all([...])", await=TRUE)` is the only parallel pattern. Each concurrent session costs a blocked worker thread, so it is a poor fit for many concurrent sessions in one process.
- **Benchmark plan:** measure webR cold start and delta RSS per worker in Node, with and without preloaded packages.
- **Julia** is impractical for agent code mode in a sandbox. The only realistic path is native Julia in a microVM, and its startup alone is 57 ms before package loading.

### Gaps
- webR: per-instance RSS, cold and warm start, effective maximum memory, speed benchmarks, which listed packages actually work, and server-side multi-tenant users.
- webR: whether `download.file("file://…")` under Node reaches the host filesystem (unverified).
- Julia: Wasm-path compile latency and empty-process RSS.

## Go (yaegi, TinyGo, Go wasip1/js, Go on Wasmer, other interpreters)

### Takeaway
**Native yaegi is Group A.** Its standard symbol table exposes `os`, `os/exec`, `net` and `net/http`. "Restricted" mode only stops a script from exiting the host process. Cancellation is cooperative and there is no memory cap. Even a hand-curated symbol map would leave it B-conditional at best, and only Go hosts can embed it.

**Compiling Go to Wasm gives Group B**, through either the gc toolchain (wasip1 or js) or TinyGo, but it is a poor fit for code mode:
- A native compiler has to run outside the sandbox before every script. Neither Go compiler runs inside Wasm.
- wasip1 has no outbound sockets.
- Host imports carry only scalars and pointers.

**yaegi compiled to Wasm** avoids the compile step but is about 40 MB. Under Node, its `net/http` fetch is disabled, so the host would have to inject a fetch.

### Cited Findings

#### yaegi (native, in-process Go interpreter)
- **(1) Identity and versions.**
  - Traefik's Go interpreter, Apache-2.0, 8.4k stars — [repo](https://github.com/traefik/yaegi).
  - **v0.16.3 (2026-11-05)**. Before that, v0.16.1 (2024-04-03); there is no v0.16.2 — [releases](https://github.com/traefik/yaegi/releases).
  - The README still says it supports Go 1.21/1.22. v0.16.3 adds a go1.27 shim for encoding/json/v2 — [stdlib-go1.27.go](https://github.com/traefik/yaegi/blob/master/stdlib/stdlib-go1.27.go).
- **(2) Group A.**
  - `i.Use(stdlib.Symbols)` exposes `os.StartProcess`, `os.RemoveAll`, `os.WriteFile`, `os.Open`, `os.Getenv` and `os.Chdir` — [go1_22_os.go](https://github.com/traefik/yaegi/blob/master/stdlib/go1_22_os.go). It also exposes the `net` and `net/http` symbols — [stdlib](https://github.com/traefik/yaegi/tree/master/stdlib).
  - "Restricted" turns `os.Exit` and `log.Fatal*` into panics, and that is all it does — [restricted.go](https://github.com/traefik/yaegi/blob/master/stdlib/restricted.go). `stdlib/unrestricted` adds `os/exec.Command` back — [unrestricted.go](https://github.com/traefik/yaegi/blob/master/stdlib/unrestricted/unrestricted.go).
  - `unsafe` and `syscall` are not exported by default — [README](https://github.com/traefik/yaegi).
  - There are no published security advisories. Issue #486 (2020) reported `os.Exit` killing the host — [issue](https://github.com/traefik/yaegi/issues/486).
- **(3) Embedding.** Go hosts only (`interp.New`, `Use`, `Eval`).
- **(4) Limits.**
  - `EvalWithContext` returns on `ctx.Done()` after signalling running frames to stop. It does not join the evaluation goroutine — [interp.go](https://github.com/traefik/yaegi/blob/master/interp/interp.go).
  - No memory, stack or instruction limits are documented.
- **(5) Host calls.** Host functions are `map[string]map[string]reflect.Value` entries, so every call goes through reflect. Scripts can use goroutines and channels — [unrestricted.go](https://github.com/traefik/yaegi/blob/master/stdlib/unrestricted/unrestricted.go).
- **(8) Speed.** "Compute-heavy interpreted code is much slower than compiled code" — [README](https://github.com/traefik/yaegi). No numbers are published.
- **(10) Ecosystem.** The full stdlib is available as symbols. There is no cgo, and "Go modules are not supported yet" — [README](https://github.com/traefik/yaegi).
- **Compile step:** none.

#### yaegi compiled to Wasm
- **Builds in use.**
  - LiveCodes runs "Yaegi v0.16.1, running go1.25.0" on Wasm. Its JS API is `goWasm.run(input)` → stdout, stderr and exit code — [LiveCodes](https://livecodes.io/docs/languages/go-wasm).
  - The community build's `yaegi-browser.wasm` is **39,830,837 bytes** uncompressed. Last pushed 2025-09-17, 2 stars — [yaegi-wasm](https://github.com/Muhammad-Ayman/yaegi-wasm).
- **(2) Group B.** It runs inside a Wasm sandbox with host-curated imports.
- **(5) Async under GOOS=js.** `syscall/js.FuncOf` callbacks "pause the event loop". Calling fetch inside one deadlocks unless it starts a goroutine. The package is "EXPERIMENTAL" — [syscall/js](https://pkg.go.dev/syscall/js).
- **(6) HTTP.**
  - On js/wasm, `net/http` uses Fetch.
  - **`jsFetchDisabled` is true when `process.argv0` starts with "node"**. In that case it falls back to a fake network — [roundtrip_js.go](https://github.com/golang/go/blob/release-branch.go1.27/src/net/http/roundtrip_js.go).

#### Go gc → Wasm (GOOS=wasip1 / js)
- **(1) Versions and ports.**
  - go1.27.4 is current — [go.dev/dl](https://go.dev/dl/).
  - wasip1 since Go 1.21 — [wiki](https://go.dev/wiki/WebAssembly).
  - `go:wasmexport` and `-buildmode=c-shared` reactors since Go 1.24 — [Go blog 2025-02-13](https://go.dev/blog/wasmexport).
  - Planned ports, both in the Backlog milestone: `GOOS=wasip2` — [#65333](https://github.com/golang/go/issues/65333); `GOARCH=wasm32` — [#63131](https://github.com/golang/go/issues/63131).
- **(3) Hosts.** wasmtime, wazero, Node `wasi`, `go_js_wasm_exec` — [wiki](https://go.dev/wiki/WebAssembly). wazero v1.12.0 (2026-05-29) has `WithMemoryLimitPages` and `WithCloseOnContextDone`, for Go hosts — [wazero config.go](https://github.com/wazero/wazero/blob/main/config.go).
- **(5) Host calls.**
  - `go:wasmimport` and `go:wasmexport` accept only bool, ints, floats, restricted pointers, and string (as a parameter only) — [cmd/compile](https://pkg.go.dev/cmd/compile).
  - Goroutines started by an export do not run after it returns — [Go blog](https://go.dev/blog/wasmexport).
- **(6) HTTP.**
  - wasip1 `src/net` has only fake and file-based networking, so **no outbound dial** — [src/net](https://github.com/golang/go/tree/release-branch.go1.27/src/net).
  - The js port uses Fetch, except under Node (see the yaegi entry above).
- **(7) Footprint.** "smallest possible size being around ~2MB", "10MB+ is common"; Brotli example 2.4M→496K — [wiki](https://go.dev/wiki/WebAssembly).
- **Compile latency:** unknown. The compiler runs outside the sandbox.

#### TinyGo → Wasm
- **(1) Versions.**
  - v0.44.0 (2026-10-28), on LLVM 23.
  - v0.42.0 (2026-09-01) added Go 1.27 support.
  - Source: [releases](https://github.com/tinygo-org/tinygo/releases).
- **Targets and goroutines.**
  - Targets wasip1, wasip2 and wasm-unknown, with `//go:wasmexport`.
  - In c-shared mode "each exported call runs in a goroutine" — [TinyGo WASI guide](https://tinygo.org/docs/guides/webassembly/wasi/).
  - Conflict: the guide says wasi-legacy goroutines work "since TinyGo 0.45", but the latest release is 0.44.0.
  - Listed hosts: Extism, Fastly, Spin, wazero (same guide).
- **(5) Async.**
  - Goroutine stacks use Asyncify.
  - v0.42 added "wasip1 poll_oneoff scheduler integration" — [releases](https://github.com/tinygo-org/tinygo/releases).
- **(6) HTTP.**
  - A wasip2 TCP PR (#5390) is open — [PR](https://github.com/tinygo-org/tinygo/pull/5390).
  - Current path is third-party wasi:http adapters — [ydnar/wasi-http-go](https://github.com/ydnar/wasi-http-go), [go.bytecodealliance.org/wasi](https://pkg.go.dev/go.bytecodealliance.org/wasi).
- **(7) Footprint.** "~10kB isn't unusual"; hello world is 575 bytes, 408 gzipped — [Go wiki](https://go.dev/wiki/WebAssembly).
- **Compile latency:** unknown. LLVM-based, so impractical to run in-sandbox (inference).

#### Go on Wasmer/WASIX and other Go interpreters (one-liners)
- **Go WASIX fork** — [wasix-org/go](https://github.com/wasix-org/go). Branch `wasix`, pushed 2026-10-29; status undocumented; B.
- **scriggo** — [repo](https://github.com/open2b/scriggo). Embeddable Go interpreter, "Secure by default. No access to packages unless explicitly enabled"; v0.61.1 (2026-03-13). B-conditional, since CPU and memory limits are unknown.
- **ixgo (goplus)** — [repo](https://github.com/goplus/ixgo). Go 1.25–1.27 interpreter; v1.2.6 (2026-10-26); packages opted in by blank import; no sandbox claims. A natively.
- **gomacro** — [repo](https://github.com/cosmos72/gomacro). Last release v2.7 (2018). A.
- **GopherJS** — [repo](https://github.com/gopherjs/gopherjs). Go→JS compiler, v1.21.0 (2026-06-26). Output is B as JS.
- **Go shell and AWK interpreters** (mvdan/sh, GoAWK): see the shells section.

### Inferences
- **A Go option would mean "agent writes Go, host compiles to Wasm, runs under wasmtime".** That adds compile latency to every script (unknown; gc is likely seconds, TinyGo slower). It also needs a WASI 0.2/0.3 HTTP path, or host imports, for tools.
- **yaegi-in-Wasm is the only no-compile route.** A 40 MB module per session is costly unless the compiled module is shared across instances.
- **Benchmark only if a "compiled language" data point is wanted.** Then TinyGo→wasip1 with host imports is the cleanest Group B case; prefer it over native yaegi.

### Gaps
- No measured compile latency, per-instance memory or host-call overhead for any Go path.
- Whether yaegi works when built for wasip1.
- Behavior when a `go:wasmexport` function blocks.
- Whether Wizer-style snapshots work with Go or TinyGo modules.

## C#/.NET, Dart and Swift

### Takeaway
None of these is a natural agent scripting runtime for a Rust or Node host. Each has one blocking problem:

- **Native .NET scripting** (Roslyn scripting, dotnet-script, F# Interactive) is **Group A**. Microsoft states that in-runtime sandboxing (CAS, AppDomains) is unsupported on .NET 6+ and tells users to rely on OS boundaries.
- **.NET on Wasm** is **Group B** inside V8. It runs the Mono IL interpreter plus the jiterpreter, has clean `[JSImport]` Task↔Promise async, and can run Roslyn inside Wasm to compile C# without leaving the sandbox. Its drawbacks are weight, unknown compile latency, and Node being only a secondary target. .NET 10 dropped WASI.
- **Native Dart** is Group A, because isolates are not a security boundary. **dart2wasm** output is Group B but needs a native compile. **dart_eval** is a capability-gated interpreter with default-deny permissions but no documented limits (B-conditional), and it needs a Dart host.
- **Swift** has had official Wasm SDKs since 6.2 (now 6.4.2) and they produce Group B output. Each script needs a native compile, Foundation is limited, and URLSession is unavailable.

### Cited Findings

#### Native .NET scripting (Roslyn, dotnet-script, F# Interactive): Group A
- **Versions**
  - Microsoft.CodeAnalysis.CSharp.Scripting 5.6.0 (2026-07-02) — [NuGet](https://www.nuget.org/packages/Microsoft.CodeAnalysis.CSharp.Scripting).
  - dotnet-script 2.0.1 (2026-05-28) — [releases](https://github.com/dotnet-script/dotnet-script/releases).
  - FSharp.Compiler.Service 43.13.404 (2026-11-10) — [NuGet](https://www.nuget.org/packages/FSharp.Compiler.Service).
- **No in-runtime sandbox.** Microsoft's .NET 6+ porting guide says:
  - "Sandboxing … isn't supported on .NET Framework and therefore is also not supported on .NET 6+. CAS is no longer treated as a security boundary".
  - "Use security boundaries provided by the operating system, such as virtualization, containers, or user accounts".
  - On extra AppDomains: "use separate processes or containers".
  - Source: [Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/net-framework-tech-unavailable).
- **PowerShell** constrained language mode needs System Lockdown plus App Control to avoid bypass, and in that mode cmdlets "have complete access to system resources". JEA allows only command invocations. Group A — [about_Language_Modes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes).

#### .NET on Wasm (browser-wasm: Mono interpreter + jiterpreter, optional AOT): Group B inside V8
- **Runtime**
  - Without AOT, apps run on an IL interpreter "with partial just-in-time (JIT) runtime support, informally referred to as the Jiterpreter" — [MS Learn (2026-11-04)](https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-build-tools-and-aot).
  - Blazor WebAssembly stays on Mono in .NET 11 — [.NET blog](https://devblogs.microsoft.com/dotnet/dotnet-maui-moves-to-coreclr-in-dotnet-11/).
  - A CoreCLR interpreter on Wasm targets an early preview in .NET 11 and stability in .NET 12 — [dotnet/runtime#121511](https://github.com/dotnet/runtime/issues/121511).
  - .NET 11.0.0 shipped 2026-11-10 — [release index](https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/releases-index.json).
- **(3) Embedding:** browsers. Bootsharp v0.9.0 (2026-06-09, MIT) "Works in browsers and JS runtimes (Node, Deno, Bun)" — [Bootsharp](https://github.com/elringus/bootsharp).
- **(5) Async and host calls:** `[JSImport]`/`[JSExport]`. A JS Promise "can be awaited in C# by a method returning a Task". Task, JSObject and similar types "create GCHandle and a proxy... These types carry significant performance overhead" — [MS interop](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/).
- **(7) Footprint:** AOT output is about 2× the IL size. Wasm AOT compile "usually takes several minutes on small projects", which rules out per-script AOT — [MS Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-build-tools-and-aot). Absolute runtime size is unknown (secondary sources conflict).
- **Roslyn inside Wasm** (compiling C# inside the sandbox):
  - DotNetLab reloads Roslyn at runtime — [DotNetLab](https://github.com/jjonescz/DotNetLab).
  - Moka.Blazor.Repl compiles code and loads NuGet packages at runtime — [NuGet](https://www.nuget.org/packages/moka.blazor.repl).
  - C# minor uses Roslyn 4.14.0 — [repo](https://github.com/MicrosoftLearning/c-sharp-minor).
  - In 2019 the high-level scripting APIs did not work on Mono-Wasm (possibly stale) — [Strathweb](https://www.strathweb.com/2019/06/building-a-c-interactive-shell-in-a-browser-with-blazor-webassembly-and-roslyn).
  - Compile latency: unknown.

#### .NET WASI
- **wasi-experimental** was removed in dotnet/runtime#108877 (Feb 2025). A maintainer indicated .NET 10 will not support WASI — [blog 2025-07-23](https://henrikrxn.github.io/blog/Wasi-dotnet-10).
- **componentize-dotnet** v0.8.0-preview00011 (2026-06-12) builds WASI 0.2 components via NativeAOT-LLVM. It warns "All the underlying technologies are under heavy development" and is pinned to Wasmtime 23.0.2 — [componentize-dotnet](https://github.com/bytecodealliance/componentize-dotnet).

#### Dart
- **Version:** 3.14.0, released 2026-11-04 — [VERSION](https://storage.googleapis.com/dart-archive/channels/stable/release/latest/VERSION).
- **Isolates are not a sandbox (native = A).** Each isolate has its own memory and event loop, but "A worker isolate can perform I/O" — [Dart concurrency](https://dart.dev/language/concurrency).
- **dart2wasm (B)**
  - Requires WasmGC, JS String Builtins and EH (exception handling). Browsers: Chrome 137+, Safari 26.2+, Firefox 134+.
  - Only `dart:js_interop`/`package:web` are supported.
  - **`--standalone` targets Wasmtime 39+** and disallows `dart:js_interop`.
  - Source: [dart.dev/web/wasm](https://dart.dev/web/wasm).
  - Node support is unknown; the SDK runner documents D8, JSC and JSShell — [run_wasm.js](https://github.com/dart-lang/sdk/blob/main/pkg/dart2wasm/bin/run_wasm.js).
  - Compile latency and sizes are unknown.
- **dart_eval (B-conditional)**
  - Bytecode compiler and VM written in Dart. BSD-3. 0.8.5 (2026-05-12) — [pub.dev](https://pub.dev/packages/dart_eval).
  - Programs can't access FS, network or processes unless granted `FilesystemPermission`, `NetworkPermission` or `ProcessRunPermission`. Async/await is supported; isolates are not.
  - Vendor claim: "10-50x slower" than AOT Dart, "roughly on par with Ruby".
  - **No instruction, memory or timeout limits documented** (same source). flutter_eval 0.8.2.

#### Swift for Wasm (official Swift SDK for Wasm)
- **Status and versions**
  - "Swift 6.2 gains support for WebAssembly" (2025-09-15) — [Swift blog](https://swift.org/blog/swift-6.2-released/).
  - Current docs install 6.4.2 SDKs (`_wasm` and `_wasm-embedded`). WasmKit runs `swift run`. Embedded output is "multiple orders of magnitude smaller" (vendor claim) — [getting started](https://www.swift.org/documentation/articles/wasm-getting-started.html).
  - 6.4.2 released 2026-10-30 — [releases](https://github.com/swiftlang/swift/releases).
- **(2) B.** Wasm reaches the system "only through explicitly imported functions". WASI p1 target with a cooperative single-threaded executor (2024 vision, possibly stale) — [vision](https://github.com/swiftlang/swift-evolution/blob/main/visions/webassembly.md).
- **(10) Foundation**
  - Available in "Limited capacity". FoundationNetworking, Process, RunLoop and Dispatch are unavailable — [SwiftWasm book](https://book.swiftwasm.org/getting-started/porting.html).
  - URLSession fails to compile on WASI — [SPI build log](https://swiftpackageindex.com/builds/3408DCDD-8CB3-4F40-A854-4D14DD038D37).
  - FoundationEssentials provides JSONDecoder, Calendar and related types — [swift-foundation](https://github.com/swiftlang/swift-foundation).
- **(5) Async**
  - JavaScriptKit 0.63.0 (2026-11-04) uses `installGlobalExecutor()` + `try await JSPromise(...).value` — [JavaScriptKit](https://github.com/swiftwasm/JavaScriptKit), [SwiftWasm book](https://swiftwasm.github.io/swiftwasm-book/getting-started/concurrency.html).
  - A 6.2.0 regression broke async entrypoints. The workaround is `typealias DefaultExecutorFactory = JavaScriptEventLoop` — [Swift forums](https://forums.swift.org/t/swift-6-2-async-await-no-longer-works-on-webassembly-with-js-interop-crashes-instantly-on-suspension/82269).
- **Compile latency and binary sizes:** unknown. Linker memory and time were "significantly reduced" (no figures) — [forum](https://forums.swift.org/t/swift-for-wasm-september-october-2025-updates/82966).
- **WasmKit** 0.4.2 (2026-10-11) is a Wasm runtime written in Swift — [WasmKit](https://github.com/swiftwasm/WasmKit).

#### Other (one-liners)
- **Fable** 5.27.0 (2026-11-04): compiles F# to JS/TS/Python/Rust/Dart. Output is B when run as JS — [Fable](https://github.com/fable-compiler/Fable).
- **Bolero:** F# on Blazor — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).
- **NativeAOT-LLVM:** last commit 2026-09-22 — [runtimelab](https://github.com/dotnet/runtimelab/tree/feature/NativeAOT-LLVM).

### Inferences
- **.NET-in-Wasm with Roslyn inside is the only option here that keeps the whole compile-and-run loop inside a Group B boundary.** That makes it the right benchmark candidate if a statically typed, "enterprise" language is wanted.
  - Expect heavy per-instance memory: the Mono runtime plus Roslyn plus reference assemblies.
  - Expect a noticeable first compile.
- **Swift, Dart and Go** would all be "compile outside, run inside". Their benchmark cost is dominated by native compile latency, which no source quantified.
- **dart_eval** is only relevant if the host is Dart or Flutter.

### Gaps
- No measured compile latency, per-instance memory or cold start for .NET Wasm (with or without Roslyn), dart2wasm, dart_eval or Swift Wasm.
- .NET WASI status in .NET 11.
- Whether dart2wasm output runs on Node.
- Whether HttpClient works over fetch under Node.

## JVM languages (Java, Kotlin, Scala, Groovy) and GraalVM polyglot sandboxing

### Takeaway
- **Every in-JVM scripting option is Group A.** JEP 486 permanently disabled the Security Manager in JDK 24 and tells users to sandbox Java like native code. Groovy's own docs say SecureASTCustomizer "is not a sandbox", and Jenkins' Groovy sandbox has 22+ bypass CVEs.
- **GraalVM's polyglot isolates under `SandboxPolicy.UNTRUSTED` are the one credible in-process sandbox on the JVM**, but they are borderline B, not B:
  - Only JS, Python and Wasm guests are supported.
  - The sandbox has had a hard isolate heap cap and CPU and statement fuel limits since 25.1 (2026-06-30), including in Community Edition.
  - There is no Rust or Node binding, and downloads run 61–120 MB per language.
- **The Java→Wasm/JS compilers** (TeaVM 0.16, Kotlin/Wasm Beta, Scala.js 1.22, J2CL, GraalVM Web Image) produce Group B output. They still need a JVM-based compile step outside the sandbox, except TeaVM's in-browser compiler and CheerpJ, which is browser-only.

### Cited Findings

#### GraalVM polyglot sandbox (GraalJS / GraalPy / GraalWasm in isolates)
- **(1) Versions**
  - GraalVM 25 shipped 2025-09-16 — [JDK 25 notes](https://www.graalvm.org/release-notes/JDK_25).
  - Monthly feature releases followed: 25.1.3 (2026-06-30) through **25.5.5.0.3 (2026-11-03)**. LTS CPU 25.0.5 shipped 2026-10-20 — [release calendar](https://www.graalvm.org/release-calendar/).
  - Maven polyglot is at 25.5.5.0.3 — [Maven Central](https://repo1.maven.org/maven2/org/graalvm/polyglot/polyglot/maven-metadata.xml).
- **(1) Licenses**
  - Oracle `js-isolate` is GFTC plus MIT/UPL — [POM](https://repo1.maven.org/maven2/org/graalvm/polyglot/js-isolate-linux-amd64/25.5.5.0.3/js-isolate-linux-amd64-25.5.5.0.3.pom).
  - The `-community` isolate is MIT/UPL only — [Maven](https://repo1.maven.org/maven2/org/graalvm/js/js-isolate-linux-amd64-community/25.5.5.0.3/).
  - GFTC forbids charging fees for services that redistribute the Program — [GFTC](https://www.oracle.com/downloads/licenses/graal-free-license.html).
- **(2) Policies**
  - CONSTRAINED blocks native access, processes, host files and sockets, env and host class loading.
  - ISOLATED adds a separate VM and heap, with heap and CPU caps mandatory.
  - UNTRUSTED adds memory, AST-depth and stream caps, untrusted-code mitigations, and no host collections.
  - Source: [GraalVM sandboxing](https://www.graalvm.org/latest/security-guide/sandboxing/).
  - Vendor rule: "It is unsupported to run untrusted code with any other policy than UNTRUSTED" — [SandboxPolicy.java](https://raw.githubusercontent.com/oracle/graal/master/sdk/src/org.graalvm.polyglot/src/org/graalvm/polyglot/SandboxPolicy.java).
- **(2) Which languages are UNTRUSTED-capable** (registration annotations on master)
  - Yes: JS — [JavaScriptLanguage.java](https://raw.githubusercontent.com/oracle/graaljs/master/graal-js/src/com.oracle.truffle.js/src/com/oracle/truffle/js/lang/JavaScriptLanguage.java); Python — [PythonLanguage.java](https://raw.githubusercontent.com/oracle/graalpython/master/graalpython/com.oracle.graal.python/src/com/oracle/graal/python/PythonLanguage.java); Wasm — [WasmLanguage.java](https://raw.githubusercontent.com/oracle/graal/master/wasm/src/org.graalvm.wasm/src/org/graalvm/wasm/WasmLanguage.java).
  - No, TRUSTED only: TruffleRuby — [RubyLanguage.java](https://raw.githubusercontent.com/oracle/truffleruby/master/src/main/java/org/truffleruby/RubyLanguage.java); Espresso — [EspressoLanguage.java](https://raw.githubusercontent.com/oracle/graal/master/espresso/src/com.oracle.truffle.espresso/src/com/oracle/truffle/espresso/EspressoLanguage.java); LLVM — [LLVMLanguage.java](https://raw.githubusercontent.com/oracle/graal/master/sulong/projects/com.oracle.truffle.llvm.runtime/src/com/oracle/truffle/llvm/runtime/LLVMLanguage.java).
- **(2) Isolate artifacts and edition support**
  - Isolate artifacts exist for `js-isolate` (since 23.1), `python-isolate` (24.1) and `wasm-isolate` (25.0) — [embedding docs](https://www.graalvm.org/latest/reference-manual/embed-languages/).
  - **Community Edition** gained ISOLATED, UNTRUSTED and sandbox limits in 25.1 — [25.1 notes](https://www.graalvm.org/release-notes/25.1/).
- **(2) Hardening**
  - Constant blinding, randomized entry points, and memory-access masking with speculation barriers — [sandboxing](https://www.graalvm.org/latest/security-guide/sandboxing/).
  - 25.0 "Monocle" Spectre mitigation, "about 4x faster" than the fence-based one, AMD64 — [JDK 25 notes](https://www.graalvm.org/release-notes/JDK_25).
- **(2) CVEs (third-party summaries)**
  - No public CVE is described as a polyglot-sandbox escape.
  - CVE-2022-21597: GraalVM EE JS, unauthorized read — [Wiz](https://www.wiz.io/vulnerability-database/cve/cve-2022-21597).
  - CVE-2026-87288: Compiler component, "full takeover", GraalVM 25.0.4.1 — [Wiz](https://www.wiz.io/vulnerability-database/cve/cve-2026-87288).
- **(3) Embedding from Rust or Node: no official API**
  - Supported hosts are Java (JVM or Native Image). "Sandboxing is not supported from within GraalVM's Node.js" — [sandboxing](https://www.graalvm.org/latest/security-guide/sandboxing/).
  - The Native Image C API (`graal_create_isolate`, `graal_attach_thread`) allows a custom C-ABI wrapper — [C API](https://www.graalvm.org/latest/reference-manual/native-image/native-code-interoperability/C-API/).
  - JNI routes: Rust [jni](https://crates.io/crates/jni) or [j4rs](https://crates.io/crates/j4rs); npm [java](https://www.npmjs.com/package/java).
- **(4) Resource limits**
  - `sandbox.MaxCPUTime`: checked every 10 ms.
  - `sandbox.MaxStatements`: deterministic fuel.
  - `MaxASTDepth`, `MaxStackFrames` and `MaxThreads` ("multithreading is not supported under UNTRUSTED").
  - `sandbox.MaxHeapMemory` is soft.
  - **Hard isolate heap:** `engine.MaxIsolateMemory` / `IsolateOption.MaxHeapSize` (exceeding it closes the context).
  - `engine.IsolateMode=external` (experimental) runs the guest in a separate process.
  - Sources: [sandboxing](https://www.graalvm.org/latest/security-guide/sandboxing/), [embedding docs](https://www.graalvm.org/latest/reference-manual/embed-languages/).
- **(5) Host calls and async**
  - Values cross as `Value`/`Proxy`. Host and guest GCs "are unaware of one another" — [embedding docs](https://www.graalvm.org/latest/reference-manual/embed-languages/).
  - GraalJS can `await` Java "thenables" — [JavaInteroperability.md](https://raw.githubusercontent.com/oracle/graaljs/master/docs/user/JavaInteroperability.md).
  - A JS Context "cannot be accessed by two or more threads, concurrently" — [Multithreading.md](https://raw.githubusercontent.com/oracle/graaljs/master/docs/user/Multithreading.md).
- **(6) HTTP:** host sockets are disallowed under CONSTRAINED and stricter, and GraalJS has no `fetch` option — [JSContextOptions.java](https://raw.githubusercontent.com/oracle/graaljs/master/graal-js/src/com.oracle.truffle.js/src/com/oracle/truffle/js/runtime/JSContextOptions.java).
- **(7) Footprint**
  - Per-context and per-isolate RSS and creation time: **unknown**.
  - Download sizes for 25.5.5.0.3 on linux-amd64, measured by the researcher via Content-Length: js-isolate 73.4 MB, js-isolate-community 61.9 MB, python-isolate 120.1 MB, wasm-isolate 30.4 MB — [Maven js-isolate](https://repo1.maven.org/maven2/org/graalvm/js/js-isolate-linux-amd64/25.5.5.0.3/), [python-isolate](https://repo1.maven.org/maven2/org/graalvm/python/python-isolate-linux-amd64/25.5.5.0.3/).
- **(9) Snapshots:** auxiliary engine caching persists code only, not context data. `engine.CachePreinitializeContext` exists — [aux caching](https://www.graalvm.org/latest/graalvm-as-a-platform/language-implementation-framework/AuxiliaryEngineCaching/).
- **(10) Ecosystem**
  - GraalJS 25.1 defaults to ES2026.
  - "JavaScript polyglot isolate now includes support for WebAssembly" — [25.1 notes](https://www.graalvm.org/release-notes/25.1/).
  - GraalPy sandboxing requires the Java POSIX backend. Native extensions need `allowNativeAccess`, which UNTRUSTED forbids — [Embedding-Permissions](https://raw.githubusercontent.com/oracle/graalpython/master/docs/user/Embedding-Permissions.md). Inference: no numpy or pandas.
- **(11) Users:** none confirmed running untrusted code.

#### Compile-to-Wasm/JS paths (Group B output)
- **TeaVM**
  - Versions: 0.16.0 (2026-10-02), 0.15.0 (2026-06-14) — [releases](https://github.com/konsoletyper/teavm/releases). 0.14.0 removed the non-GC Wasm and WASI backends — [0.14 notes](https://teavm.org/docs/release-notes/0.14.0.html).
  - Node support out of the box since 0.13. WasmGC coroutines exist. The compiler can run in the browser (playground) — [0.13 notes](https://teavm.org/docs/release-notes/0.13.0.html).
  - The WasmGC backend needs a JS loader — [Loader API](https://www.teavm.org/docs/wasm-gc-backend/loader.html).
  - Compile latency and size: unknown.
- **Kotlin/Wasm**
  - Beta since 2.2.20 — [stability](https://kotlinlang.org/docs/components-stability.html). Latest 2.4.21 (2026-10-08) and 2.5.0-RC (2026-11-11) — [releases](https://github.com/JetBrains/kotlin/releases).
  - wasmJs needs WasmGC — [overview](https://kotlinlang.org/docs/wasm-overview.html).
  - wasmWasi (preview1) runs in Wasmtime, WasmEdge, Node and Deno — [template](https://github.com/Kotlin/kotlin-wasm-wasi-template), [examples](https://github.com/Kotlin/kotlin-wasm-examples).
  - Vendor speed claim: "approaching that of the JVM" — [overview](https://kotlinlang.org/docs/wasm-overview.html).
- **Scala.js 1.22.0 (2026-06-20)**
  - "The WebAssembly backend is now officially stable." It needs a JS host ("we do not currently generate standalone Wasm").
  - `js.async`/`js.await` need JSPI (`.withUseJSPI(true)`).
  - Source: [announcement](https://www.scala-js.org/news/2026/06/20/announcing-scalajs-1.22.0/).
- **J2CL / J2Wasm**
  - v20261026 — [releases](https://github.com/google/j2cl/releases). J2CL is "production ready". The Wasm backend is "work-in-progress" — [README](https://github.com/google/j2cl/blob/master/README.md).
  - Google Sheets on WasmGC runs about 2× faster than its JS version (vendor) — [web.dev](https://web.dev/case-studies/google-sheets-wasmgc).
- **GraalVM Web Image:** experimental `--tool:svm-wasm` that emits `.js` plus `.wasm`, for Node 22+ — [README](https://github.com/oracle/graal/blob/master/web-image/README.md).
- **CheerpJ 5.0**
  - Release date conflicts: the changelog says Oct 30, 2026 and the blog says Nov 2, 2026.
  - Supports Java 8–21, with 25 in preview. It ships javac and jshell, so compilation can happen inside the sandbox. The WasmGC JIT is opt-in and marked not for production — [CheerpJ 5.0 blog](https://labs.leaningtech.com/blog/cheerpj-5.0), [changelog](https://cheerpj.com/docs/changelog).
  - Browser-only ("no server-side JVM") — [FAQ](https://cheerpj.com/docs/faq). Commercial license — [licensing](https://cheerpj.com/docs/licensing).

#### Native JVM scripting (Group A)
- **JEP 486 (JDK 24)** permanently disables the Security Manager. It declares no replacement "sandbox" and says "Java applications should be sandboxed in the same way as native applications" — [JEP 486](https://openjdk.org/jeps/486).
- **Groovy 6.0.0** — [Maven](https://repo1.maven.org/maven2/org/apache/groovy/groovy/6.0.0/). The docs say SecureASTCustomizer "is not a sandbox and not a security boundary… a demonstrated bypass is expected behaviour". They also note that compilation itself runs code (`@ASTTest`, `@Grab`) — [Groovy docs](https://docs.groovy-lang.org/latest/html/documentation/).
- **Jenkins Script Security:** 38 GitHub advisories, at least 22 titled as sandbox bypasses, from CVE-2016-3102 to CVE-2026-57280 (2026-06-24) — [plugin releases](https://github.com/jenkinsci/script-security-plugin/releases).
- **Other JVM scripting engines, all A:**
  - BeanShell 3.0.0RC3 — [releases](https://github.com/beanshell/beanshell/releases).
  - Rhino 1.9.2 — [releases](https://github.com/mozilla/rhino/releases).
  - Nashorn 15.7 — [Maven](https://repo1.maven.org/maven2/org/openjdk/nashorn/nashorn-core/maven-metadata.xml).
  - Kotlin `.kts` — [kotlin-scripting-jvm-host](https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-scripting-jvm-host/maven-metadata.xml).

#### Other (one-liners)
- **Chicory 1.7.5:** a pure-Java Wasm runtime, relevant only to JVM hosts — [releases](https://github.com/dylibso/chicory/releases).
- **Bytecoder:** last release 2024-05-10 — [repo](https://github.com/mirkosertic/Bytecoder/releases).
- **JWebAssembly:** v0.4 (2022, dormant) — [repo](https://github.com/i-net-software/JWebAssembly/releases).
- **TruffleRuby:** graal-40.0.0, TRUSTED only, so A — [releases](https://github.com/oracle/truffleruby/releases).
- **Rise JVM:** listed on [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).

### Inferences
- **A GraalJS UNTRUSTED isolate is a heavier duplicate of what agentOS already has** (a V8 isolate). It is only worth benchmarking if GraalPy-in-isolate would be the Python story, and that rules out numpy and pandas.
- **From a Rust or Node host, the realistic GraalVM deployment is a sidecar process.** That removes most of its in-process advantage.
- **Kotlin/Wasm (wasmWasi) and TeaVM are the only Java-family routes whose output runs under Wasmtime or V8 with host-only imports.** Both are "compile outside, run inside", and no source gives compile latency.

### Gaps
- GraalVM: per-context and per-isolate RSS, isolate creation time, host-call cost across the isolate boundary, and whether thenables and Proxies pass UNTRUSTED host-access checks.
- Compile latency for TeaVM, Kotlin/Wasm, Scala.js, J2CL and Web Image.
- The Wasmtime flags needed for Kotlin wasmWasi output.

## Lisp / Scheme / Clojure family (SCI, babashka, nbb, scittle, squint/cherry, Guile Hoot, Racket sandbox, Chibi/s7/TinyScheme, ECL, Steel)

### Takeaway
Only two Lisp-family options fit an in-process Group B design, because both run inside the V8 isolate or Wasm that agentOS already uses. The first is **SCI's JS build**, a Clojure interpreter: guest code can `await` host Promises through `^:async`, and an `:interrupt-fn` hook allows interruption. The second is **Guile Hoot**, which compiles Scheme to WasmGC and runs agent code through an in-Wasm `(hoot eval)` interpreter; it is pre-1.0. Native SCI on the JVM is B-conditional: it has real capability allowlists but no memory cap, and its allowlist was escaped in 2025 and 2026. babashka, nbb, Racket's sandbox, and native Guile, SBCL and ECL are Group A. No measured footprint or benchmark numbers were found for any of them.

### Cited Findings

#### SCI (Small Clojure Interpreter)
- **(1)** "Configurable Clojure/Script interpreter suitable for scripting and Clojure DSLs."
  - Runs on the JVM, as a GraalVM native image, on ClojureScript/JS (including `:advanced` builds) and on ClojureDart.
  - EPL-1.0 — [babashka/sci README](https://github.com/babashka/sci).
  - Latest 0.15.59, pushed 2026-10-05 — [Clojars](https://clojars.org/org.babashka/sci).
- **(2) Group.**
  - The JS build inside a V8 isolate is **B**: the isolate is the boundary.
  - The JVM and native-image builds are **B-conditional**. The capability model is real:
    - Guest code reaches only vars that are explicitly provided, and built-ins are read-only.
    - Interop is limited to the `:classes` list.
    - `:allow` and `:deny` filter symbols.
    - `future` and `pmap` are disabled by default.
    - Sources: [README](https://github.com/babashka/sci), [README raw](https://raw.githubusercontent.com/babashka/sci/master/README.md).
  - **Escapes:**
    - 0.13.53 (2026-06-20): a string type hint `^"some.Class" x` bypassed the `:classes` allowlist, because `Class/forName` loaded and statically initialized classes at analysis time.
    - 0.10.47 (2025-06-27): "function recursion can be forced by returning internal keyword as return value."
    - 0.10.46 (2025-06-18): functions no longer hold on to their context.
    - Source: [SCI CHANGELOG](https://raw.githubusercontent.com/babashka/sci/master/CHANGELOG.md).
  - No memory cap is documented.
  - A June 2026 #sci discussion pointed to Node worker threads as a better substrate for untrusted SCI scripts — [clojurians #sci log](https://clojurians-log.clojureverse.org/sci/2026-06-16) (via search summary).
- **(3) Embedding.**
  - JVM: library.
  - Node: SCI ships inside scittle and nbb. The README's npm `@borkdude/sci` section is commented out — [README raw](https://raw.githubusercontent.com/babashka/sci/master/README.md).
  - Rust: no crate.
- **(4) Limits.**
  - `:realize-max` and `:preset :termination-safe` were removed in 0.2.0 because termination could not be guaranteed.
  - `:interrupt-fn` (0.13.52, 2025-06-16) is "a zero-arg function called on every interpreted fn entry".
  - `sci.interrupt/interrupt!` (0.13.53) throws an interrupt that sandboxed `try`/`catch` cannot catch.
  - On the JVM, regex functions honour the interrupt.
  - Source: [CHANGELOG](https://raw.githubusercontent.com/babashka/sci/master/CHANGELOG.md).
- **(5) Host calls and async.**
  - Host functions are exposed by mapping symbols to values in `:namespaces`.
  - On CLJS, guest code can `await` JS Promises: `^:async` on `defn` (0.12.51, 2025-02-07) or `:async true` (0.15.58).
  - `sci.async` (experimental) makes namespace loading async — [async.md](https://raw.githubusercontent.com/babashka/sci/master/doc/async.md), [CHANGELOG](https://raw.githubusercontent.com/babashka/sci/master/CHANGELOG.md).
- **(6) HTTP:** none built in; host fetch only (same sources).
- **(7) Footprint:** nbb, which includes SCI, is "around 1.2MB" with about 170 ms baseline startup on the author's laptop — [nbb](https://github.com/babashka/nbb). The SCI-JS bundle size is unknown.
- **(8) Speed:** a tight loop takes about 175 ms interpreted versus about 7 ms with the CLJS JIT. The JIT is on by default and generates functions with `js/Function` — [README raw](https://raw.githubusercontent.com/babashka/sci/master/README.md).
- **(11) Users:** babashka, nbb, scittle, Clerk, 4ever-clojure, clj-kondo, Joyride, Portal, TryClojure.org, Maria.cloud, Logseq and Malli — [README](https://github.com/babashka/sci). None was found using SCI as a server-side boundary for untrusted code.

#### babashka, nbb, scittle, squint / cherry
- **babashka (A).**
  - A GraalVM native binary that bundles `babashka.curl`, `fs`, `process` and cheshire. Pods are external programs.
  - The README shows `bb -e 0` at about 0.017 s total — [babashka](https://github.com/babashka/babashka).
  - Latest found: 1.12.218 (2026-04-20) — [CHANGELOG](https://raw.githubusercontent.com/babashka/babashka/master/CHANGELOG.md).
- **nbb (A).** SCI on Node.js. Promises come through promesa, npm libraries load through `import()`, and it makes no sandbox claims — [nbb](https://github.com/babashka/nbb).
- **scittle (B inside an isolate).** "The Small Clojure Interpreter exposed for usage in script tags." Version unknown — [scittle](https://github.com/babashka/scittle).
- **squint / cherry (B inside an isolate).**
  - Both compile ClojureScript syntax to JS — [clojureverse](https://clojureverse.org/t/squint-a-clojurescript-syntax-to-js-compiler/9246).
  - cherry was "pretty stable now" in July 2025 — [#cherry log](https://clojurians-log.clojureverse.org/cherry/2025-07-04).

#### Guile Hoot (Spritely)
- **(1) Basics.**
  - A Scheme→WebAssembly compiler for Guile: R7RS-small, "a bit of R6RS" and a Guile subset. "API should be considered unstable" — [Hoot status](https://files.spritely.institute/docs/guile-hoot/latest/Status.html).
  - **0.9.0 (2026-05-13):** standard exnref exceptions, DWARF, `hoot compile`/`hoot strip`, and host-provided types for Wastrel — [Hoot 0.9.0](https://spritely.institute/news/hoot-0-9-0-released.html).
  - 0.8.0 (2026-02-25) — [Hoot 0.8.0](https://spritely.institute/news/hoot-0-8-0-released.html).
  - License: unknown.
- **(2) B.**
  - Guest code is WasmGC running in the host engine.
  - Runs on Firefox ≥121, Chrome ≥119, Safari ≥26 and Node ≥22.3.0. Binaries "conform to the Wasm 3.0 specification." "Currently unsupported on WASI runtimes" — [Hoot supported platforms](https://files.spritely.institute/docs/guile-hoot/latest/Supported-platforms.html).
- **Runtime eval, the key question for agent code.**
  - The AOT compiler runs on native Guile.
  - **`(hoot eval)` runs inside Wasm.**
    - In 0.5.0 (2024-09-06) it handled "base Scheme syntax only" — [Hoot 0.5.0](https://www.spritely.institute/news/guile-hoot-v050-released.html).
    - Earlier releases "added a macro expander, a Scheme interpreter, and a runtime module system"; modules are "loaded from source and then interpreted", and a `hoot repl` runs in Node — [Hoot 0.8.0](https://spritely.institute/news/hoot-0-8-0-released.html).
    - In 0.9.0 the interpreter supports `define-record-type` with up to 8 fields — [Hoot 0.9.0](https://spritely.institute/news/hoot-0-9-0-released.html).
- **(5) Async.** Delimited continuations use an explicit stack because Wasm 3.0 cannot capture frames, and Hoot plans to migrate when stack switching ships — [Hoot status](https://files.spritely.institute/docs/guile-hoot/latest/Status.html). Promise integration: unknown.
- **(6) HTTP:** host only. 0.8.0 added `(web request)`, `(web response)` and `(web socket)` modules — [Hoot 0.8.0](https://spritely.institute/news/hoot-0-8-0-released.html).
- **(7)/(8) Footprint and speed:** no published sizes or speeds.
  - `-g1` debug info makes "compilation time and binary size … increase significantly".
  - Wastrel, a WasmGC→C compiler, "runs faster than the same program on NodeJS" (vendor claim) — [Hoot 0.8.0](https://spritely.institute/news/hoot-0-8-0-released.html).

#### Racket `racket/sandbox` (A) and RacketScript
- **Defaults** — [Racket sandbox docs](https://docs.racket-lang.org/reference/Sandboxed_Evaluation.html):
  - `make-evaluator` creates a fresh custodian and namespace.
  - `sandbox-memory-limit` defaults to 30 MB.
  - `sandbox-eval-limits` defaults to 30 s and 20 MB, and applies only "when memory accounting is available".
  - Security and network guards deny filesystem and network access.
  - Host functions are passed in through `requires` or `sandbox-init-hook`.
- **The docs warn:** "an attacker who identifies a vulnerability in Racket or an installed collection may be able to escape the sandbox", and they recommend OS isolation as well (same source).
- **RacketScript** is an "experimental", "not mature" Racket→JS compiler without proper tail calls or continuations — [RacketScript](https://github.com/racketscript/racketscript).

#### Small Schemes/Lisps and Lisp-on-Wasm (one-liners)
- **Steel:** an "embeddable and extensible scheme dialect built in Rust" with a bytecode VM. "May change at any time while pre 1.0." Limits, async and Wasm are not documented. B-conditional — [steel](https://github.com/mattwparas/steel).
- **ECL:** 26.3.27 (2026-03-27) includes emscripten fixes — [ECL 26.3.27](https://ecl.common-lisp.dev/posts/ECL-26327-release.html). Emscripten support started in 23.9.9 and was bytecode-compiler only — [ECL 23.9.9](https://ecl.common-lisp.dev/posts/ECL-2399-release.html). Native is A; the Emscripten build is B-conditional (preliminary).
- **Chibi-Scheme:** 0.11.0 (June 2024) — [chibi list](https://groups.google.com/g/chibi-scheme/c/38TpmDQE6TQ). "Each VM runs in an isolated heap" — [chibi-scheme](https://github.com/ashinn/chibi-scheme) (search summary). Limits unknown.
- **s7 (CCRMA):** a Scheme interpreter whose tarball "changes daily"; other details unknown — [s7](https://ccrma.stanford.edu/software/s7/).
- **TinyScheme:** not verified this session (search budget exhausted); possibly stale.
- **Scheme and Lisp in JS (B inside an isolate):**
  - LIPS 1.0.0-beta.21 — [lips.js.org](https://lips.js.org/).
  - BiwaScheme covers "most of the features of R7RS small" but lacks `syntax-rules` and exceptions — [biwascheme](https://github.com/biwascheme/biwascheme).
- **ketos:** a Rust Lisp compiling to bytecode, v0.11. No limits are documented; B-conditional — [ketos](https://github.com/murarth/ketos).
- **Scheme→Wasm compilers:**
  - Schism, a self-hosting Scheme→Wasm compiler, is "no longer actively maintained" — [ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fgoogle%2Fschism).
  - scheme.wasm, an R7RS in Wasm — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).
  - Goeteia, a self-hosting Scheme compiler on WasmGC — [zeli](https://zeli.app/story/48877314).
- **Other Lisp-on-Wasm:** Wisp, Femto Emacs, and Wracket (unmaintained) — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).
- **clojail:** an older JVM Clojure sandbox whose docs warn that if users "find a way to use 'eval', they can eval any code they like". A, stale — [cljdoc](https://cljdoc.org/d/juji/clojail/1.0.9/api/clojail.core).
- **Not verified this session:** Gambit (JS backend), JSCL, rust_lisp, SBCL and native Guile. All are native A except the JS-emitting compilers.

### Inferences
- **SCI-JS is the lowest-cost Clojure path for agentOS.**
  - It runs as ordinary guest JS inside the existing isolate, so it adds no new boundary and has real async/await on host tools.
  - Its default JIT uses `js/Function`. If the isolate disallows string codegen, loops slow down by about 25× (from the 175 ms vs 7 ms figures above).
- **Hoot needs WasmGC, tail calls and exnref**, which in practice means V8 (Node ≥22.3).
  - Agent code would be interpreted by `(hoot eval)`, because the AOT compiler runs only on native Guile.
  - Whether Wasmtime can host Hoot output is unknown.
- **Racket's sandbox is one of the better-documented in-process sandboxes**, with memory and time limits and I/O guards. It is still classed A here: its own docs say a runtime bug escapes it, and it needs a Racket process beside a Rust or Node host.

### Gaps
- The web-search budget ran out mid-research, so the long tail rests on search summaries.
- No per-context memory, bundle size or benchmark exists for SCI-JS, Hoot, Steel or Chibi.
- Hoot's license and AOT compile latency are unknown, as is whether it runs in a bare V8 isolate without Node or browser APIs.
- TinyScheme, Gambit, JSCL and SBCL were not verified.

## Haskell and OCaml

### Takeaway
Both languages produce good Group B Wasm output. The GHC Wasm backend is a "tech preview". wasm_of_ocaml 6.5 is active and runs in production at Jane Street.

- **OCaml is unusual because the compiler can run inside the sandbox.** The js_of_ocaml/wasm_of_ocaml toplevel compiles `.cmo` files on the fly to Wasm, so the compile-and-run loop can stay within Group B.
- **GHC has the best async model in this whole catalog.** A `safe` JSFFI import suspends only the calling green thread on a JS Promise, without JSPI. This is still a JS-host-only feature, and GHC itself is enormous: a full GHCi in the browser is about 220 MB compressed, and GHC-in-browser downloads about 50 MB.

Both ecosystems lack agent-oriented data, chart and office libraries, so their agent fit is weak. MicroHs is the one small Haskell that runs in Wasm.

### Cited Findings

#### GHC WebAssembly backend
- **(1) Status and versions.**
  - `wasm32-wasi` cross-compiler, "tech preview and not included in the official bindists yet" — [GHC user guide (wasm)](https://ghc.gitlab.haskell.org/ghc/doc/users_guide/wasm.html).
  - Latest GHC releases: 9.14.1 (2025-12-19) and 9.12.4 (2026-03-27) — [haskell.org/ghc](https://www.haskell.org/ghc/).
- **(5) JSFFI.**
  - `unsafe` imports are synchronous and block the RTS.
  - `safe`/default imports are **async**: forcing the result suspends only that Haskell green thread while the Promise settles, with no JSPI needed.
  - Exports return Promises by default.
  - Limitations:
    - Single-threaded RTS.
    - `WouldBlockException` when forcing async thunks from C-FFI exports.
    - JS↔Haskell cycles leak without `freeJSVal`.
    - Async exceptions don't cancel the Promise.
  - Runs in Node, the browser, or `wasmtime run` (pure WASI) — [user guide](https://ghc.gitlab.haskell.org/ghc/doc/users_guide/wasm.html).
- **(compile) Template Haskell and ghci.**
  - Supported "starting from ghc-9.12" via a Node `dyld.mjs` external interpreter. Splices can do WASI file I/O.
  - Compiling pandoc took about 16 minutes on a 4-core runner, peaking at 10.8 GB on the author's laptop — [Tweag 2024-11-21](https://tweag.io/blog/2024-11-21-ghc-wasm-th-ghci/).
- **GHC-in-browser.** The GHC API plus the bytecode interpreter, fully client-side (2025-10-25).
  - Downloads a rootfs of about 50 MB, freezes for "a few seconds", and has no cabal — [Haskell Discourse](https://discourse.haskell.org/t/ghc-now-runs-in-your-browser/13169).
  - An earlier full GHCi in the browser was about 220 MB compressed — [Sagar 2024](https://vaibhavsagar.com/blog/2024/07/03/ghci-in-the-browser/).
- **GHC JS backend.**
  - FFI imports are arrow-function strings, with `syncCallback`/`asyncCallback` — [JS backend guide](https://ghc.gitlab.haskell.org/ghc/doc/users_guide/javascript.html).
- **MicroHs (B-conditional).**
  - 0.16.0.0 (2026-06-02), Apache-2.0, a combinator-reduction runtime that "can compile itself", with an Emscripten JS/Wasm browser demo — [Hackage](https://hackage.haskell.org/package/MicroHs), [GitHub](https://github.com/augustss/MicroHs).
  - One maintainer, no documented limits.
- **hint (A).** 0.9.0.9 (2026-02-15), built on the GHC API, and needs GHC installed — [Hackage](https://hackage.haskell.org/package/hint).
- **Safe Haskell.** Not a credible boundary; deprecation debated — [Discourse](https://discourse.haskell.org/t/deprecating-safe-haskell-or-heavily-investing-in-it/5489).
- **Others:**
  - Asterius: deprecated — [Tweag](https://tweag.io/blog/2024-11-21-ghc-wasm-th-ghci/).
  - DHC, HaskellWasm, haskell-wasm, wasm-cross: listed (mostly unmaintained) — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).

#### OCaml: wasm_of_ocaml and js_of_ocaml
- **(1) Versions and requirements.**
  - 6.5.0: GitHub release 2026-10-22, opam 2026-10-25 — [releases](https://github.com/ocsigen/js_of_ocaml/releases), [opam](https://opam.ocaml.org/packages/wasm_of_ocaml-compiler/).
  - Needs WasmGC, tail calls and EH. Runs on Chrome 119, Node 22, Firefox 122 and Safari 18.2 — [README_wasm_of_ocaml](https://github.com/ocsigen/js_of_ocaml/blob/master/README_wasm_of_ocaml.md).
  - License: GPL-2.0+/LGPL-2.1+ with the OCaml linking exception.
- **(5) Effects.**
  - `--effects=jspi` is the default and needs Chrome 137 or Node 25.
  - `cps` runs anywhere.
  - `native` (stack switching) is behind a flag.
  - Source: [README](https://github.com/ocsigen/js_of_ocaml/blob/master/README_wasm_of_ocaml.md).
- **(compile-in-sandbox) Toplevel and Dynlink.**
  - In 6.4, `.cmo` files are "compiled on the fly to WebAssembly and instantiated at runtime" — [wasm overview](https://ocaml.org/p/js_of_ocaml/6.4.1/doc/wasm_overview.html).
  - 6.5 adds Async and Web Worker toplevel APIs — [releases](https://github.com/ocsigen/js_of_ocaml/releases).
- **WASI target (`--enable wasi`, WASI 0.1).**
  - Runs on wasmtime with `-W=all-proposals=y`.
  - Missing: JS bindings, networking, dynlink, processes. Weak references are not weak, and marshalling is quadratic — [wasm overview](https://ocaml.org/p/js_of_ocaml/6.4.1/doc/wasm_overview.html).
- **(8) Speed.**
  - Jane Street reports 2–8× faster than js_of_ocaml.
  - About 2× slower than native.
  - Runtime checks cost about 10% on V8.
  - Source: [Tarides 2025-02-19](https://tarides.com/blog/2025-02-19-the-first-wasm-of-ocaml-release-is-out).
- **(11) Users.** Jane Street, and the OCaml Playground on the js_of_ocaml toplevel — [OCaml backstage](https://ocaml.org/backstage/2026-04-16-wasm-of-ocaml-what-changed-since-6-1).
- **Wasocaml.** Experimental Flambda→WasmGC; claimed 10–20% faster than js_of_ocaml in 2023 (possibly stale) — [OCaml.org](https://ocaml.org/tools/wasm-target), [2023 update](https://discuss.ocaml.org/t/an-update-from-the-ocaml-wasm-organization/13114).
- **OCamlRun.** The bytecode interpreter compiled to Wasm via Emscripten, unmaintained — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).

### Inferences
- **OCaml toplevel-in-Wasm/JS is a genuine "compile inside the sandbox" option.** It is worth a small benchmark only if a typed functional language is wanted, since its library ecosystem for data and office work is thin.
- **GHC's async JSFFI is the model to copy for code mode** (one green thread per pending tool call). The toolchain weight and compile times make Haskell impractical for per-request agent scripts.

### Gaps
- GHC Wasm output sizes, run speed and small-script compile latency (the ghc-wasm-meta GitLab pages were blocked by bot protection).
- wasm_of_ocaml binary sizes and toplevel compile latency.
- Whether WasmGC heaps can be capped separately from the host JS heap.

## Erlang/Elixir, Prolog and Tcl

### Takeaway
**Prolog has the cleanest code-mode async story in this group.**
- **Trealla Prolog** (WASI build, npm `trealla`) yields a running query back to the host whenever a host predicate returns a Promise. It supports several interpreters and concurrent queries per interpreter, and wraps the host's `fetch` as `http_fetch/3`.
- **SWI-Prolog Wasm** has `await/2` inside async queries.
- Both are Group B in Wasm. As with other Emscripten ports, their JS-eval predicates (`js_eval_json`, `:=`) must be stripped.

**Erlang/Elixir in Wasm runs on AtomVM.** Popcorn 1.x is AtomVM in the browser. Both are Group B but immature, with unknown limits and async semantics. Dune is a weak native Elixir sandbox, and native BEAM is A.

**Tcl's safe interpreters are the oldest capability-based design here.** Dangerous commands are hidden, host functions arrive as aliases, and `interp limit` caps command count and time. Because Tcl lacks a memory limit and runs as C, it is B-conditional. The only Tcl-in-Wasm port, wacl, is stale (Tcl 8.6.6, 2017).

### Cited Findings

#### AtomVM and Popcorn (BEAM in Wasm)
- **AtomVM.** A "Tiny Erlang VM" (Apache-2.0) for MCUs and "Browsers and NodeJS with WebAssembly". Runs code compiled by OTP 21–27 — [AtomVM](https://github.com/atomvm/AtomVM).
  - Stable v0.6.6 (2025-06-23).
  - v0.7.0-beta.0 (dated "30 Sep", 2026 inferred) adds an Emscripten Wasm32 JIT, tracked JS object handles and `.mjs` modules — [releases](https://github.com/atomvm/AtomVM/releases).
  - "Crashes may still occur in edge cases" — [AtomVM](https://github.com/atomvm/AtomVM).
  - Size: AtomVM is "about 190KB" compressed, and it "surpasses 3MB" with the Erlang/Elixir libraries — [Software Mansion blog 2025-07-22](https://swmansion.com/blog/popcorn-bringing-elixir-to-the-browser-8993a58a00be).
- **Popcorn.** "Runs Elixir and Erlang applications in the browser on a BEAM virtual machine compiled to WebAssembly", with OTP processes and supervision. Apache-2.0 — [popcorn](https://github.com/software-mansion/popcorn).
  - It can "compile Elixir code — all on the client side" — [SWM blog](https://swmansion.com/blog/popcorn-bringing-elixir-to-the-browser-8993a58a00be).
  - Now 1.x: docs titled v1.0.2 — [hexdocs](https://popcorn.hexdocs.pm/). Published as npm `@swmansion/popcorn` plus a Hex package — [SWM, Mar 2026](https://swmansion.com/blog/the-three-lang-problem-shipping-elixir-runtime-js-and-webassembly-as-one-npm-package-5a7b76ad5b90) (search summary).
  - In 2025 it was called "unsuitable for production" (possibly stale).
- **Dune (B-conditional, native BEAM).**
  - Version 0.3.18. Allowlisted evaluation in an isolated process, with a fixed atom pool. It "cannot offer strong security guarantees" — [Dune readme](https://dune.hexdocs.pm/readme.html).
  - Defaults: `max_heap_size` 30_000, `max_reductions` 30_000, `timeout` 50 ms — [Dune.Opts](https://dune.hexdocs.pm/Dune.Opts.html).
- **Lumen/Firefly** was archived on 2024-06-10 — [firefly](https://github.com/GetFirefly/firefly). ElixirWasm is unmaintained — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).

#### Trealla Prolog
- **(1) Overview.** C99, MIT, "Stable state and feature-complete". Builds for Cosmopolitan, WASI and Go — [trealla](https://github.com/trealla-prolog/trealla).
  - Latest tag **v3.15.10 (2026-11-13)** — [tags](https://github.com/trealla-prolog/trealla/tags).
- **(2) Group.** WASI build is B. Native is A: it has an FFI (`use_foreign_module/2`), HTTP client predicates and an HTTP server — [trealla](https://github.com/trealla-prolog/trealla).
- **(3) Embedding.**
  - **trealla-js** (npm `trealla`, "beta!") runs in browsers and Node — [trealla-js](https://github.com/guregu/trealla-js).
  - The Go embedding via wazero is v0.25.0 (2026-07-15). Filesystem is opt-in, cancellation uses `context.Context`, and it is "about 2x slower than native" (vendor claim) — [pkg.go.dev](https://pkg.go.dev/github.com/trealla-prolog/go).
  - No Rust crate.
- **(4) Limits.** `call_with_time_limit/2`, `call_with_inference_limit/3`, and a default memory cap implied by the `--nolimit` flag — [trealla](https://github.com/trealla-prolog/trealla).
- **(5) Async** — [trealla-js](https://github.com/guregu/trealla-js):
  - **"Returning a promise will cause the query to yield to the host."** Host predicates can be async functions or async generators, the latter yielding choice points.
  - Multiple interpreters can run, and concurrent queries can run on one interpreter.
  - Results come back as JSON by default.
  - **Caveat:** `js_eval_json` evaluates JS in the global environment.
- **(6) HTTP.** `http_fetch/3` wraps the host's `fetch` (same source).

#### Scryer Prolog
- **Overview.** A Rust WAM implementation, BSD-3. Crate 0.10.0 (docs 2026-10-08) exposes `Machine`, `MachineBuilder`, `QueryState` and `Term` — [docs.rs](https://docs.rs/scryer-prolog/latest/scryer_prolog/).
- **Host calls and limits.** No documented host-callback, async or resource-limit API beyond `call_with_inference_limit/3`.
- **Wasm.** Support is "basic", built through `wasm-pack` — [scryer-prolog](https://github.com/mthom/scryer-prolog). No official npm package; a third-party `scryer` 0.7.0 is "Experimental" — [pkgstats](https://www.pkgstats.com/pkg:scryer).
- **Group.** Native is A (it has `http_open` and an FFI). Wasm is B-conditional.

#### SWI-Prolog Wasm
- **Package.** npm **swipl-wasm 8.3.0 (2026-11-06)**, BSD-2-Clause — [libraries.io](https://libraries.io/npm/swipl-wasm). Runs in Node and browsers — [npm-swipl-wasm](https://github.com/SWI-Prolog/npm-swipl-wasm).
- **JS interop** — [SWI-Prolog wasm manual](https://www.swi-prolog.org/pldoc/man?section=wasm):
  - `:=/2` calls JS.
  - **`await/2` waits on a Promise inside async queries.** It cannot yield inside a C→Prolog callback.
  - `fetch/3` and `sleep/1` yield.
- **Sandbox.** `library(sandbox)` checks `safe_goal/1` statically against a whitelist of predicates. No time or memory limits are mentioned — [sandbox.pl](https://www.swi-prolog.org/pldoc/doc/_SWI_/library/sandbox.pl).

#### Other Prolog engines and LLM use
- **Tau Prolog** 0.3.4: pure JS, B inside an isolate — [README](https://cdn.jsdelivr.net/npm/tau-prolog@0.3.4/README.md).
- **ichiban/prolog**: Go, MIT, last update 2026-01-31. The zero-value interpreter has no predicates, so it is B-conditional for Go hosts — [awesome-go](https://awesome-go.com/embeddable-scripting-languages/prolog-ichiban-github).
- **Ciao Prolog** has an Emscripten Wasm playground — [awesome-wasm-langs](https://github.com/appcypher/awesome-wasm-langs).
- **LLM agents using Prolog:**
  - PrologMCP exposes Prolog as a stateful MCP tool — [arXiv](https://arxiv.org/abs/2606.14935).
  - An RLVR paper trains models to use Prolog as a tool — [arXiv](https://arxiv.org/html/2512.07407).
  - DeepClause built a coding agent in Prolog — [DeepClause](https://deepclause.substack.com/p/implementing-a-vibed-llm-coding-agent).

#### Tcl
- **Tcl 9.0.4 (2026-06-26)** — [tcl-lang](https://www.tcl-lang.org/software/tcltk/9.0.html).
- **Safe interpreters (B-conditional).** Details from the [interp man page](https://www.tcl-lang.org/man/tcl9.0/TclCmd/interp.html):
  - `interp create -safe` hides `exec`, `open`, `socket`, `file`, `load`, `source`, `cd`, `glob` and `zipfs`.
  - Host functions come in as parent `interp alias` commands.
  - `interp limit` provides command-count and time limits, with a callback and granularity.
  - **There is no memory limit.** `recursionlimit` "cannot by itself prevent stack overflows on the C stack".
  - No safe-interpreter escape CVE was found. The nearest is CVE-2021-35331, a disputed bug in a build helper — [Tenable](https://tenable.com/cve/CVE-2021-35331).
- **Ports and reimplementations:**
  - **wacl**: Tcl 8.6.6 on Emscripten 1.37.9, last updated 2017 (possibly stale). LiveCodes uses it — [wacl](https://github.com/ecky-l/wacl), [LiveCodes](https://next.livecodes.io/docs/languages/tcl).
  - **Jim Tcl 0.83 (2024-08-28)**: safe and limit options unknown — [release](https://jim.tcl-lang.org/home/doc/www/www/articles/jim-release-0-83/).
  - **molt**: a Rust Tcl subset, 0.3.1, which "does not provide all of the features of Standard TCL". Forks exist (molt-forked 0.4.5, molt-wasm 0.4.4), and the original is reportedly unmaintained — [docs.rs](https://docs.rs/crate/molt/latest), [molt-wasm](https://docs.rs/crate/molt-wasm/0.4.4).

### Inferences
- **Trealla via trealla-js is the one niche language worth a micro-benchmark**, because its async-generator host-predicate model maps directly onto parallel tool calls. Prolog itself is a poor fit for general agent scripting: it lacks the dataframes, charts and office libraries agents use. The Prolog-as-a-tool usage above points the same way.
- **Tcl safe interpreters are the best-documented native capability sandbox in this group.** Missing memory caps and C memory safety keep Tcl at B-conditional. No maintained Tcl 9 Wasm build exists to lift it to B.
- **AtomVM and Popcorn deserve a watch, not a benchmark.** The BEAM's lightweight processes would map well onto concurrent tool calls, but the Wasm port's limits and async bridge are undocumented.

### Gaps
- Wasm binary sizes and per-instance memory for Trealla, SWI and AtomVM.
- Whether SWI time and inference limits work inside Wasm.
- Popcorn 1.x's JS API, async semantics and Node support.
- Rust or Node bindings for Tcl, and Tcl's async model.
- Search budget ran out mid-research. Many long-tail facts rest on fetched pages or search summaries.

## Shells and Unix tools as agent runtimes (just-bash, bashkit, Wasm coreutils/BusyBox, Wasmer WASIX bash, Nushell, goawk, mvdan/sh, emulators, native bash)

### Takeaway
**Bash usage.** Every major coding agent ships a bash tool. Vendors report that replacing bespoke tools with bash plus a filesystem cut cost and steps.

**Limits of bash.** Bash does not beat SQL on structured data: in the Braintrust/Vercel eval, bash scored 52.7% accuracy at about 7× the tokens of SQL. The two published code-mode designs (Anthropic, Cloudflare) chose TypeScript, not bash.

**In-process simulated shells (B-conditional).** Two in-process simulated shells are the cheapest way to give an agent bash with tools as commands:

| | just-bash | bashkit |
|---|---|---|
| Implementation | TypeScript | Rust |
| Version | 3.6.0 (2026-10-01) | 0.21.0 (2026-11-11) |
| Host tools as commands | async `defineCommand` | async `Builtin` trait |
| HTTP | allowlisted `curl` | allowlisted `curl`; can delegate to a host HTTP transport |
| Limits | many execution and FS caps | many execution and FS caps |
| Hard heap cap | no | no |
| Advisories | one High (hard-link escape) | none |

Each becomes Group B when run inside a V8 isolate (just-bash's core) or compiled to Wasm (bashkit-wasm).

**Real bash and coreutils compiled to WASIX (Wasmer)** give real semantics with a large host surface. Wasmer published a Critical sandbox-escape advisory in Oct–Nov 2026.

**Emulators** (container2wasm, v86, CheerpX) are heavy upper bounds.

**Native bash** is Group A and needs bubblewrap/seccomp (Claude Code `srt`, Codex) or a microVM.

### Cited Findings

#### just-bash (Vercel Labs, TypeScript)
- **(1) What it is.** "A simulated bash environment with virtual filesystem", Apache-2.0 — [repo](https://github.com/vercel-labs/just-bash).
  - It is a beta in-memory bash in TypeScript for Node ≥20.19. Each `exec()` starts fresh shell state, while the filesystem persists — [README](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/README.md).
  - Releases: 1.0.0 (2025-12-27), 3.0.0 (2026-05-10), **3.6.0 (2026-10-01)** — [npm](https://registry.npmjs.org/just-bash).
- **(2) Group B-conditional.**
  - For: "no code path exists from bash interpretation to JavaScript execution", and it never imports `child_process`. Other defenses are path containment, network off by default, re2js against ReDoS, and prototype-pollution guards — [THREAT_MODEL](https://raw.githubusercontent.com/vercel-labs/just-bash/main/THREAT_MODEL.md).
  - Against: "Execution has no VM isolation". Node `resourceLimits` don't reliably cap Wasm memory, so "strong memory containment requires process or container isolation" — [README](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/README.md).
  - **Advisory GHSA-g5pf-mh4h-h655 (High, 2026-09-15):** "ReadWriteFs allows sandbox escape via pre-existing hard links" — [advisories](https://github.com/vercel-labs/just-bash/security/advisories).
- **(4) Limits.**
  - Profiles: `executionLimitProfile` `normal` or `hardened`.
  - Caps: `maxCallDepth`, `maxCommandCount`, `maxFileSystemBytes`, `maxOutputSize`, `maxExecutionTimeMs`, and more. A per-`exec` `signal` cancels at statement boundaries — [README](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/README.md).
  - The threat model adds caps on loop iterations, string and array sizes, brace expansion and globs — [THREAT_MODEL](https://raw.githubusercontent.com/vercel-labs/just-bash/main/THREAT_MODEL.md).
- **(5) Host tools** — [README](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/README.md):
  - `defineCommand(name, async (args, ctx))` returns stdout, stderr and exit code. `trusted: false` gives a restricted extension boundary.
  - **`@just-bash/executor` turns GraphQL, OpenAPI and MCP endpoints into bash namespace commands.**
  - The opt-in `js-exec` runs QuickJS (64 MB limit) and exposes host tools as a `tools` proxy.
  - Whether `&`/`wait` run async commands concurrently is unknown.
- **(6) HTTP** — [README](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/README.md):
  - Without network config, `curl` is "command not found".
  - Allowlisting: `allowedUrlPrefixes` (origin plus path prefix, with optional header transforms for credentials) and `allowedMethods` (default GET and HEAD). Redirects are re-checked.
  - Responses are capped at 10 MB — [THREAT_MODEL](https://raw.githubusercontent.com/vercel-labs/just-bash/main/THREAT_MODEL.md).
- **(7) Footprint.** npm unpacked size was 2.64 MB (v1.5.2) and 3.75 MB (v2.4.0). 3.6.0 depends on `typescript`, `sql.js`, QuickJS and `re2js` — [npm](https://registry.npmjs.org/just-bash). No per-instance memory or latency numbers.
- **(10) Commands.** About 80, including grep, sed, awk, rg, find, xargs, **jq, yq, xan, sqlite3 (sql.js)**, tar and gzip. Opt-in `python3` (CPython in Wasm) and `js-exec`. Filesystems: InMemoryFs, OverlayFs (copy-on-write over a real directory), ReadWriteFs, MountableFs. The core shell runs in browsers — [README](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/README.md).
- **(11) Users.** Default backend of Vercel's **bash-tool**. `createBashTool` returns `bash`, `readFile` and `writeFile` AI SDK tools, and the backend can be just-bash, `@vercel/sandbox` or a custom one — [bash-tool README](https://raw.githubusercontent.com/vercel-labs/bash-tool/main/README.md), [InfoQ](https://www.infoq.com/news/2026/01/vercel-bash-tool).

#### bashkit (everruns, Rust)
- **(1) What it is.** "Awesomely fast virtual sandbox with bash and file system", in-process, 167 builtins in Rust, MIT — [README](https://raw.githubusercontent.com/everruns/bashkit/main/README.md).
  - **0.21.0 (2026-11-11)**. The crate was created 2026-02-03 and has 125,113 downloads — [crates.io](https://crates.io/api/v1/crates/bashkit).
- **(2) B-conditional native, B as Wasm.**
  - For: memory-safe Rust, I/O only through a virtual filesystem and allowlists, and `catch_unwind` panic recovery. Its threat model covers "280+ threats across 17 categories" — [README](https://raw.githubusercontent.com/everruns/bashkit/main/README.md).
  - No advisories — [advisories](https://github.com/everruns/bashkit/security/advisories). Young, and no fuzzing is mentioned.
- **(3) Embedding** — [README](https://raw.githubusercontent.com/everruns/bashkit/main/README.md):
  - Rust crate.
  - Node, Bun and Deno via NAPI-RS (`@everruns/bashkit`).
  - Wasm package (`@everruns/bashkit-wasm`).
  - Python, plus a C API.
- **(4) Default limits.** 10K commands; 10K iterations per loop and 1M total; function depth 100; 1 MiB stdout; 100 MB filesystem; parser 5 s and 100K fuel — [README](https://raw.githubusercontent.com/everruns/bashkit/main/README.md).
- **(5) Host tools.** Builtins implement an **`#[async_trait]` `Builtin`** and register through `Bash::builder().builtin(...)` — [docs.rs](https://docs.rs/bashkit/latest/bashkit/). Node takes `customBuiltins`, sync or async — [README](https://raw.githubusercontent.com/everruns/bashkit/main/README.md).
- **(6) HTTP.**
  - `curl`, `wget` and `http` sit behind a `NetworkAllowlist`, with a 10 MB response cap, 30 s timeout and no automatic redirects.
  - **`BashBuilder::http_transport` injects a host HTTP transport while bashkit still enforces policy** — [docs.rs](https://docs.rs/bashkit/latest/bashkit/).
- **(9) Snapshot.** `Snapshot` is "a serializable snapshot of a Bash interpreter's state"; `VfsSnapshot` also exists — [docs.rs](https://docs.rs/bashkit/latest/bashkit/).
- **(10) Ecosystem.** jq, virtual git and experimental sqlite sit behind feature flags. Python comes via Monty (a pure-Rust Python 3.12 subset) or CPython 3.14 as a Wasm guest. TypeScript runs via ZapCode, pure Rust with no V8 — [README](https://raw.githubusercontent.com/everruns/bashkit/main/README.md).
- **(7)/(8) Footprint and speed.** No numbers published.
- **Related:**
  - rust-bash 0.3.0, a Rust virtual bash in alpha — [docs.rs](https://docs.rs/crate/rust-bash/0.3.0/source/README.md).
  - ExBashkit, an Elixir wrapper — [forum](https://forum.elixirforum.com/t/exbashkit-an-elixir-wrapper-for-bashkit-a-bash-sandbox-for-llms/75730/last).

#### Wasmer bash and coreutils on WASIX
- **Versions.** Wasmer 7.5.0 (2026-10-01) — [releases](https://github.com/wasmerio/wasmer/releases). `wasmer/bash` 1.0.25 — [registry](https://wasmer.io/wasmer/bash). WASIX supports fork, vfork, exec and wait — [wasix.org](https://wasix.org/docs/explanation/features). A patched uutils build for WASIX is on the registry — [Wasmer registry](https://wasmer.io/nathanflurry/coreutils).
- **(2) B-conditional.**
  - **Advisories (Oct–Nov 2026)** — [advisories](https://github.com/wasmerio/wasmer/security/advisories):
    - GHSA-v2h8-j899-r676 (**Critical**): Singlepass miscompilation leading to native stack corruption and **sandbox escape**.
    - High: an LLVM `call_indirect` bug and a `Table` type mismatch.
    - GHSA-6936-225w-643x: **WASIX preopen rights bypass**.
    - Three unbounded host allocations controllable by the guest.
- **(3) Embedding.**
  - Rust: the `wasmer` crate.
  - Node: `@wasmer/sdk` 0.19.1, 5.6 MB unpacked, Node ≥20 — [npm](https://registry.npmjs.org/@wasmer/sdk/latest). Its API is `wasmer.sandboxes.create({packages, files, network})` then `sandbox.command().run()`.
  - Browsers need COOP/COEP and SharedArrayBuffer — [Wasmer JS docs](https://docs.wasmer.io/runtime/js).
- **(4) Limits.** Rust has `Metering` (an operator count) — [wasmer-middlewares](https://docs.rs/wasmer-middlewares/latest/wasmer_middlewares/). The JS SDK documents no memory or time limits.
- **(6) HTTP.** Network is off by default. In Node, `network: {mode:'host'}` maps WASIX TCP/DNS onto Node's networking, with no documented allowlist — [Wasmer JS docs](https://docs.wasmer.io/runtime/js).
- **(7) Vendor numbers (Apple M5 Max).** Sandbox creation "0.1ms"; startup 2–10× and command runs 10–20× faster than Docker or remote sandboxes — [Wasmer 2026-09-01](https://wasmer.io/posts/wasmer-local-sandboxes-for-ai-agents).

#### uutils coreutils, BusyBox, Nushell, brush, mvdan/sh, GoAWK
- **uutils coreutils.** 0.12.0 (2026-09-17) publishes a `wasm32-wasip1` tarball, and 0.10.0 added wasip2. On the GNU test suite it passes 653 and fails 21 — [releases](https://github.com/uutils/coreutils/releases). It needs a separate shell. Group B inside a Wasm runtime.
- **BusyBox.** No official WASI port.
  - An Emscripten build exists — [busyboxnanozipdiff3](https://github.com/vadimkantorov/busyboxnanozipdiff3).
  - So does go-busybox, built with TinyGo for WASI at about 2.0 MB — [mirror](https://github.blesdmm.dns-dynamic.net/rcarmo/go-busybox).
  - Both are B-conditional (unofficial).
- **Nushell.** CI builds `nu-engine`, `nu-command` and other crates for `wasm32-unknown-unknown`, but there is no wasip1/wasip2 job and no shipped Wasm shell — [ci.yml](https://raw.githubusercontent.com/nushell/nushell/main/.github/workflows/ci.yml). Native is A.
- **brush.** A bash-compatible shell in Rust (MIT) with 2,500+ tests diffed against bash. `Shell::builder()` supports custom builtins. Its WASI 0.3 build is "experimental" — [README](https://raw.githubusercontent.com/reubeno/brush/main/README.md). brush-core 0.5.0 (2026-05-03) — [crates.io](https://crates.io/api/v1/crates/brush-core). Group A (it runs real processes).
- **mvdan/sh `interp` v3.14.1 (2026-09-06).**
  - `DefaultExecHandler` runs binaries from PATH. `ExecHandlers`, `CallHandler`, `OpenHandler`, `ReadDirHandler2`, `StatHandler` and `AccessHandler` virtualize I/O — [pkg.go.dev](https://pkg.go.dev/mvdan.cc/sh/v3/interp), [releases](https://github.com/mvdan/sh/releases).
  - A by default. B-conditional if every handler is replaced.
- **GoAWK v1.32.0 (2026-09-15).** `NoExec`, `NoFileWrites` and `NoFileReads` are "useful when executing untrusted scripts". `Funcs` exposes Go functions. Context is checked every 1000 instructions ("not preemptive") — [pkg.go.dev](https://pkg.go.dev/github.com/benhoyt/goawk/interp). B-conditional, Go hosts only.

#### Full-system emulation (Group B by the rubric, heavy)
- **container2wasm v0.5.0.** Bochs (x86_64), TinyEMU (RISC-V) or QEMU. The kernel is pre-booted with wizer. Networking options: a fetch proxy, a WebSocket relay or WASI sockets. Runs on wasmtime and wazero. Generated images include GPL parts — [container2wasm](https://github.com/container2wasm/container2wasm).
- **v86.** "x86 PC emulator and x86-to-wasm JIT", 32-bit guests only, with save/restore of state. BSD-2 — [v86](https://github.com/copy/v86).
- **WebVM / CheerpX.** CheerpX needs a commercial license for business use. Browser only — [CheerpX licensing](https://cheerpx.io/docs/licensing).
- **JSLinux.** About **100 MIPS** in Firefox on a 2017 desktop (possibly stale). Networking through a WebSocket VPN at 40 kB/s — [JSLinux tech](https://bellard.org/jslinux/tech.html).
- **WebContainers.** "Browser-based runtime for executing Node.js applications" with startup in "milliseconds" (vendor). Browser only — [WebContainers](https://webcontainers.io/guides/introduction).

#### Native bash under OS sandboxing (Group A)
- **Anthropic sandbox-runtime (`srt`) 0.0.83** — [README](https://cdn.jsdelivr.net/gh/anthropics/sandbox-runtime/README.md):
  - Uses bubblewrap on Linux (no network namespace; traffic goes through host HTTP/SOCKS5 proxies, and seccomp blocks Unix sockets) and Seatbelt on macOS.
  - Domain allow/deny lists. Node API `SandboxManager.wrapWithSandbox`. A "beta research preview". No CPU or memory limits are documented.
  - Sandboxing "safely reduces permission prompts by 84%" in Claude Code — [Anthropic 2025-10-20](https://www.anthropic.com/engineering/claude-code-sandboxing).
- **Codex CLI** — [codex linux-sandbox README](https://raw.githubusercontent.com/openai/codex/main/codex-rs/linux-sandbox/README.md):
  - bubblewrap is the default: read-only root plus writable roots, then `PR_SET_NO_NEW_PRIVS` and seccomp (which blocks `io_uring`).
  - Network is either cut entirely or proxy-only.
- **microVM, gVisor and container services:**
  - Vercel Sandbox is Firecracker: 1–32 vCPU at 2 GB per vCPU — [concepts](https://examples.vercel.com/docs/vercel-sandbox/concepts), [pricing](https://vercel.com/docs/vercel-sandbox/pricing).
  - Modal uses gVisor or VMs; lifetime is 5 min by default, up to 24 h — [Modal](https://modal.com/docs/guide/sandboxes).
  - Cloudflare Containers range from 256 MiB to 12 GiB — [limits](https://developers.cloudflare.com/containers/platform-details/limits/).
  - E2B is "a fast, secure Linux VM", and pause saves both filesystem and memory — [E2B docs](https://docs.e2b.dev/).
  - Startup times from a third-party list with no methodology: E2B about 150 ms, Daytona about 90 ms, Blaxel about 25 ms, Cloudflare and Beam 2–3 s — [superagent](https://hub.superagent.sh/blog/ai-code-sandbox-benchmark-2026).

#### How common is bash-style scripting for agents?
- **Every major coding agent has a shell tool.**
  - Claude Code's bash tool runs under `srt` — [Anthropic](https://www.anthropic.com/engineering/claude-code-sandboxing).
  - Codex runs sandboxed shell commands — [Codex](https://raw.githubusercontent.com/openai/codex/main/codex-rs/linux-sandbox/README.md).
  - Gemini CLI's `run_shell_command` uses `bash -c` — [Gemini CLI docs](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/shell.md).
  - Terminal-Bench tracks terminal agents — [tbench.ai](https://www.tbench.ai/).
- **Vendor results (small samples).**
  - Vercel's d0 text-to-SQL agent moved from 17 tools to bash in Vercel Sandbox. On 5 queries, time went from 274.8 s to 77.4 s, success from 80% to 100%, tokens fell 37% and steps 42% — [Vercel 2025-12-22](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools).
  - A sales-call agent went from about $1.00 to $0.25 per call — [Vercel 2026-01-09](https://vercel.com/blog/how-to-build-agents-with-filesystems-and-bash).
- **Counter-evidence.** Braintrust/Vercel eval on semi-structured data:

  | Agent | Accuracy | Tokens | Cost |
  |---|---|---|---|
  | SQL | 100% | 155,531 | $0.51 |
  | Bash (just-bash) | 52.7% | 1,062,031 | $3.34 |
  | Filesystem tools only | 63.0% | 1,275,871 | $3.89 |

  A bash plus SQL hybrid was most reliable, at about 2× the tokens of SQL alone — [Vercel 2026-01-22](https://vercel.com/blog/testing-if-bash-is-all-you-need).
- **Code-mode designers chose TypeScript.**
  - Anthropic's "code execution with MCP" generates TypeScript (150k → 2k tokens, 98.7%) and requires "a secure execution environment with appropriate sandboxing, resource limits, and monitoring" — [Anthropic 2025-11-04](https://www.anthropic.com/engineering/code-execution-with-mcp).
  - Cloudflare: "JavaScript… is designed to be sandboxed. It is the correct language for the job." Vendor numbers: isolates take a few ms and a few MB, versus containers at hundreds of ms and hundreds of MB — [Cloudflare 2026-03-24](https://blog.cloudflare.com/dynamic-workers).
- **Model language preference.** LLMs default to Python, using it in 58% of high-performance tasks where it is not optimal. Bash was not measured — [Twist et al., arXiv 2503.17181](https://arxiv.org/abs/2503.17181).

### Inferences
- **Fit.** Bash fits file and document exploration and quick text or data plumbing (grep, jq, sqlite3). It fits poorly for fan-out across many async host tools with structured results: concurrency is only `&`/`wait`, and pipes carry text.
- **What to benchmark.** The candidates are just-bash in Node (or inside an isolate) and bashkit in Rust (native and Wasm), each with tools registered as async commands. Measure concurrent `cmd & … wait` against serial calls.
- **Cost ladder** (only Wasmer's vendor numbers are published): in-process simulated shell < WASIX bash < native bash + bubblewrap < remote microVM < full-system emulation.

### Gaps
- Per-instance memory and latency for just-bash, bashkit, Wasmer bash, srt and Codex sandboxes.
- Whether `&`/`wait` give real concurrency for async custom commands in just-bash and bashkit.
- Wasmer JS SDK custom-command API and resource limits.
- Cursor's shell tool details.
- No data on how often LLMs pick bash vs Python vs JS for data tasks.

## SQL and query engines as sandboxed data-processing compute (DuckDB, SQLite, DataFusion, Polars, chDB, PGlite)

### Takeaway
SQL engines are the cheapest credible "data-processing compute" to sandbox, but only their Wasm builds (DuckDB-Wasm, SQLite Wasm/wa-sqlite, PGlite) are Group B; DuckDB's own docs say native DuckDB is not a security boundary ("treat SQL like Bash or Python"), native SQLite is a strong B-conditional when locked down (limits, authorizer, progress handler, hard heap limit, no ATTACH/extensions), DataFusion is B-conditional (Rust, capability-style table registration, memory pool, but DDL must be disabled), and chDB is Group A. Agents mostly reach these engines through narrow SQL tools (`run_sql`/`query_dataset`) rather than as a general scripting language, and the agentOS Pyodide path already ships DuckDB 1.5.1 and Polars 1.33.1.

### Cited Findings

#### DuckDB (native, embedded)
- **(1) Version/status:** DuckDB 2.0.0 LTS "Cinnamon Teal" released 2026-10-21, LTS support until at least Oct 2027; 1.5 support extended to Mar 2027 — [Announcing DuckDB 2.0.0](https://duckdb.org/2026/10/21/announcing-duckdb-200). 1.5.0 "Variegata" released 2026-03-09 — [Announcing DuckDB 1.5.0](https://duckdb.org/2026/03/09/announcing-duckdb-150); latest 1.5.x patch seen: 1.5.6 (2026-09-28) — [Announcing DuckDB 1.5.6](https://duckdb.org/2026/09/28/announcing-duckdb-156). 2.0 adds the Quack client-server protocol, a PEG parser, triggers, VARIANT shredding and async I/O for Parquet/CSV (per search summaries of the 2.0 post; [AlternativeTo](https://alternativeto.net/news/2026/10/duckdb-s-major-2-0-release-turns-the-database-management-system-into-a-full-fledged-server/)). Implementation: vectorized C++ engine, in-process (no JIT). License MIT (DuckDB-Wasm repo states MIT — [duckdb-wasm](https://github.com/duckdb/duckdb-wasm)).
- **(2) Group A (vendor statement).** "Treat SQL in DuckDB like code in Bash or Python. Do not execute SQL from untrusted sources without proper sandboxing." DuckDB "executes SQL with the full privileges of the user running it"; its settings are defense-in-depth and "not a substitute for proper sandboxing"; recommended sandboxes include duckdb-wasm, containers with restricted capabilities, VMs/low-privilege processes, and network isolation — [Securing DuckDB (2.0 docs)](https://duckdb.org/docs/2.0/operations_manual/securing_duckdb/overview.html).
- **CVEs/escapes:** CVE-2024-41672: `sniff_csv` read local files even with `enable_external_access=false` and locked configuration (PoC read `/proc/self/environ`); fixed in 1.1.0 — [NVD](https://nvd.nist.gov/vuln/detail/cve-2024-41672), [Wiz](https://www.wiz.io/vulnerability-database/cve/cve-2024-41672). A product built on DuckDB (Arc) had CVE-2026-47735 (local-file read via DuckDB I/O functions despite `enable_external_access` + allowed directories) and CVE-2026-55098 (incomplete fix; reachable via I/O function aliases on DuckDB 1.5.x) — [Corgea CVE-2026-55098](https://corgea.com/advisories/vulnerabilities/CVE-2026-55098). CVE-2025-59037: npm supply-chain compromise (malicious duckdb 1.3.3 and @duckdb/duckdb-wasm 1.29.2, 2025-09-08) — [NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-59037), [GitLab advisory](https://advisories.gitlab.com/npm/duckdb/CVE-2025-59037/).
- **(3) Embedding:** Primary-tier clients include C, Go, Java, Node.js ("node-neo"), Python, R, Rust and WebAssembly — [DuckDB client overview](https://duckdb.org/docs/2.0/clients/overview.html).
- **(4) Resource controls:** `threads`, `memory_limit`, `max_temp_directory_size`; lockdown via `enable_external_access=false`, `disabled_filesystems` (e.g. `LocalFileSystem`), `allowed_directories`/`allowed_paths` (not read-only), `lock_configuration=true`, `autoload_known_extensions`/`autoinstall_known_extensions=false`, `allow_community_extensions=false`; no query-timeout or CPU-time setting ("Implement strict query timeouts at the application level") — [Securing DuckDB](https://duckdb.org/docs/2.0/operations_manual/securing_duckdb/overview.html). `memory_limit` is not a hard RSS cap: "some operations circumvent the database's buffer manager" — [DuckDB OOM guide](https://duckdb.org/docs/lts/guides/troubleshooting/oom_errors.html); with a 10 MB limit "the memory overhead is over 25MB" (R client) — [krlmlr/duckdb-mem](https://github.com/krlmlr/duckdb-mem).
- **(5) Host calls/async:** unknown in this pass for UDF cost; SQL execution is synchronous per query; 2.0 adds async I/O for Parquet/CSV reads internally — [AlternativeTo summary](https://alternativeto.net/news/2026/10/duckdb-s-major-2-0-release-turns-the-database-management-system-into-a-full-fledged-server/).
- **(6) HTTP:** via `httpfs` extension (ambient network unless `enable_external_access=false`) — [Securing DuckDB](https://duckdb.org/docs/2.0/operations_manual/securing_duckdb/overview.html).
- **(7) Footprint:** no clean idle-RSS figure found; duckdb-mem regression intercept ~141 (units not stated, likely MB, R process incl. data) — [krlmlr/duckdb-mem](https://github.com/krlmlr/duckdb-mem) (weak evidence).
- **(10) Agent fit:** Agents typically get DuckDB through SQL tools. Vercel's guide (2026-10-26) runs DuckDB + Python inside a per-dataset Vercel Sandbox microVM behind an MCP server (`load_dataset`, `query_dataset`, `run_python`), opens the DB `read_only=True`, `enable_external_access: False`, `lock_configuration`, network deny-all except during load, results capped (≤500 rows, 20,000 chars) to keep data out of the model's context — [Vercel KB](https://vercel.com/kb/guide/large-scale-data-analysis-vercel-sandbox-mcp). BoxHero (2026-05-12) runs an LLM SQL agent over per-tenant ~5 MB DuckDB files queried client-side in the browser; the agent uses `run_sql` (EXPLAIN-validated, returns only `{ok,totalRows}`) and `inspect_sql` (read-only, ≤20 rows) tools, ~$0.01/request, 12-step cap, Claude Sonnet 4.6 — [BoxHero engineering](https://www.boxhero.io/engineering/ai-sql-agent-duckdb-wasm). MotherDuck recommends per-agent zero-copy clones as sandboxes — [MotherDuck](https://motherduck.com/learn/motherduck-ai-agent-data-layer/).

#### DuckDB-Wasm
- **(1) Version:** Conflicting: the 2.0 docs say "The latest stable version of the DuckDB WebAssembly client is 2.0.0" — [DuckDB Wasm overview (2.0 docs)](https://duckdb.org/docs/2.0/clients/wasm/overview.html); the GitHub README says "currently based on DuckDB v1.5.6" — [duckdb-wasm README](https://github.com/duckdb/duckdb-wasm); last tagged GitHub release visible was v1.33.0 (16 Dec, "no real differences from 1.32.0"), v1.31.0 based on DuckDB 1.4.0 — [duckdb-wasm releases](https://github.com/duckdb/duckdb-wasm/releases). MIT.
- **(2) Group B:** runs inside Wasm; DuckDB lists duckdb-wasm as a recommended sandbox — [Securing DuckDB](https://duckdb.org/docs/2.0/operations_manual/securing_duckdb/overview.html).
- **(3) Embedding:** npm `@duckdb/duckdb-wasm`; "tested with Chrome, Firefox, Safari and Node.js" — [README](https://github.com/duckdb/duckdb-wasm). Browser API is `AsyncDuckDB` over a Web Worker (docs example) — [Wasm overview](https://duckdb.org/docs/2.0/clients/wasm/overview.html).
- **(4) Limits:** single-threaded by default, multithreading "still experimental"; "WebAssembly limits the amount of available memory to 4 GB" — [Wasm overview](https://duckdb.org/docs/2.0/clients/wasm/overview.html). Stack size changed to 1 MB in v1.30.0 (partially reverted) — [releases](https://github.com/duckdb/duckdb-wasm/releases).
- **(6) HTTP:** virtual FS handles HTTP(S); JS httpfs "fetches only the required byte ranges" while the built-in httpfs extension "may currently download the whole file" (issue #2153) — [Wasm overview](https://duckdb.org/docs/2.0/clients/wasm/overview.html). Extensions supported in Wasm since v1.29.0: autocomplete, fts, httpfs, icu, inet, json, parquet, spatial, sqlite_scanner, substrait, tpcds, tpch, vss; OPFS support added in v1.30.0 — [releases](https://github.com/duckdb/duckdb-wasm/releases). Extensions are fetched lazily from extensions.duckdb.org — [README](https://github.com/duckdb/duckdb-wasm).
- **(7) Footprint (third-party):** `duckdb-mvp.wasm` ≈36 MB raw / ≈12 MB gzipped, extensions ≈7.4 MB — [pkgstats @dotdo/duckdb](https://www.pkgstats.com/pkg:@dotdo/duckdb); repackaged "Ducklings" browser build ≈5.7 MB gzipped, Workers build ≈9.7 MB gzipped because Asyncify adds ≈4 MB — [Ducklings docs](https://ducklings-api.pages.dev/Browser_vs_Workers); demo extensions ≈3.2 MB compressed — [README](https://github.com/duckdb/duckdb-wasm). Per-instance RSS: unknown.
- **(11) Users:** BoxHero (client-side agent analytics) — [BoxHero](https://www.boxhero.io/engineering/ai-sql-agent-duckdb-wasm).

#### SQLite (native)
- **(1) Version:** 3.53.0 (2026-04-09) re-released the withdrawn 3.52.0 — [3.53.0 release log](https://sqlite.org/releaselog/3_53_0.html); 3.53.2 (2026-06-03) fixed FTS5 heap overflow CVE-2026-11822/-11824 — [SQLite CVEs](https://www.sqlite.org/cves.html); 3.53.3 "fixed problems … mostly coming from AIs" — [3.53.3 release log](https://sqlite.org/releaselog/3_53_3.html); 3.54.0 dates conflict (Oct 9 vs draft log Oct 15, 2026) — [draft release log](https://www.sqlite.org/draft/releaselog/current.html). Public domain, C, bytecode VM (VDBE).
- **(2) Group: B-conditional when locked down (my classification).** Vendor stance: "SQLite should never crash, overflow a buffer, leak memory … even when presented with maliciously malformed SQL inputs or database files"; "extensively fuzz-tested"; "Nevertheless, bugs happen" — [SQLite security](https://www.sqlite.org/security.html). "Almost all CVEs written against SQLite require the ability to inject and run arbitrary SQL" (i.e. exactly the agent case); Chrome/Safari WebSQL were the main deliberate untrusted-SQL exposures — [SQLite CVEs](https://www.sqlite.org/cves.html). SQL-reachable memory-corruption CVEs 2024-2026: CVE-2025-3277/-29087 (`concat_ws` heap write, fixed 3.49.1), CVE-2025-6965 (array over-read, fixed 3.50.2), CVE-2026-11822/-11824 (FTS5 heap write when DEFENSIVE off, fixed 3.53.2); recommendation: ≥3.53.2 for untrusted SQL — [SQLite CVEs](https://www.sqlite.org/cves.html).
- **(4) Resource controls:** `sqlite3_limit()` with suggested high-security values (e.g. SQL_LENGTH 100,000, EXPR_DEPTH 10, VDBE_OP 25,000, ATTACH 0, LIKE_PATTERN_LENGTH 50); `SQLITE_DBCONFIG_DEFENSIVE`; `sqlite3_set_authorizer()`; `sqlite3_progress_handler()`/`sqlite3_interrupt()` for CPU; `sqlite3_hard_heap_limit64()` for memory; `SQLITE_MAX_ALLOCATION_SIZE`; `trusted_schema=OFF` — [SQLite security](https://www.sqlite.org/security.html).
- **(3) Embedding:** Rust `rusqlite` 0.42.0 (2026-11-11) with `limits` ("Run-Time Limits") and `load_extension` guard features — [docs.rs rusqlite](https://docs.rs/rusqlite/latest/rusqlite/). Node built-in `node:sqlite`: Stability 1.2 release candidate (Node v26.13.1 docs; added v22.5.0, RC since v25.7.0); `limits` object, `setAuthorizer()` (v24.10.0), `defensive` default `true` (v25.5.0/v24.14.0), `allowExtension` default `false`, `timeout`; all core APIs synchronous; no progress handler documented — [Node.js sqlite docs](https://nodejs.org/api/sqlite.html).
- **(6) HTTP:** none in core.

#### SQLite in Wasm (official sqlite3.wasm, wa-sqlite, sql.js)
- Official SQLite Wasm targets "modern WASM-capable browsers" with OPFS persistence options — [sqlite.org/wasm](https://sqlite.org/wasm/doc/trunk/index.md). Group B.
- wa-sqlite: "a WebAssembly build of SQLite with support for writing SQLite virtual filesystems completely in Javascript"; synchronous and asynchronous builds, async builds use Asyncify or JSPI and are "required for asynchronous extensions" (i.e. SQL functions/VFS that await JS) — [wa-sqlite](https://github.com/rhashimoto/wa-sqlite). Sizes/Node support not stated.

#### PGlite (Postgres in Wasm) and pglite-oxide
- "PGlite is a WASM Postgres build packaged into a TypeScript client library"; "only 3mb gzipped" (vendor claim); browsers, Node.js, Bun, Deno; "single user/connection"; in-memory or persisted (FS / IndexedDB); pgvector, PostGIS; status badge "Alpha"; Apache-2.0 + PostgreSQL License; `pg` client compatibility since v0.5.13 — [PGlite README](https://github.com/electric-sql/pglite). Core package referenced at 0.5.15 by extension releases dated 10 Nov — [PGlite releases](https://github.com/electric-sql/pglite/releases). Older size figure 3.7 MB gzipped (2024) — [Simon Willison](https://simonwillison.net/2024/Feb/23/pglite/). Group B.
- pglite-oxide 0.4.1 (Rust crate, "Embedded Postgres for Rust tests and local apps") runs on Wasmer 7.2.0-alpha.2 / WASIX; on an M1 Pro: 25,000 INSERTs in one transaction 132.36 ms native Postgres vs 149.54 ms pglite-oxide vs 257.02 ms vanilla PGlite; 5,000 indexed SELECTs 81.39 / 125.31 / 203.05 ms; no RSS/startup numbers — [pglite-oxide PERFORMANCE.md](https://docs.rs/crate/pglite-oxide/0.4.1/source/docs/PERFORMANCE.md).

#### Apache DataFusion
- **(1)** Rust query engine; latest crate 55.2.0 — [docs.rs datafusion](https://docs.rs/datafusion/latest/datafusion/). Apache-2.0.
- **(2) Group: B-conditional (native Rust embed), B in Wasm.** Memory/temp-disk controlled via `MemoryPool` and `DiskManager` — [docs.rs](https://docs.rs/datafusion/latest/datafusion/). `SQLOptions` (`with_allow_ddl`, `with_allow_dml`, `with_allow_statements`) restricts statement classes; added for read-only deployments because `COPY` to local files was a security issue and `SET` could enable DoS — [datafusion-python docs](https://datafusion.apache.org/python/autoapi/datafusion/context/), [issue #7328](https://github.com/apache/datafusion/issues/7328) (via search summary). `CREATE EXTERNAL TABLE … LOCATION` accepts local paths and object-store URLs — [DataFusion DDL](https://datafusion.apache.org/user-guide/sql/ddl.html), so DDL must be disabled for untrusted SQL.
- **Wasm:** the `wasmtest` crate verified that datafusion-common (no parquet), -expr, -optimizer, -physical-expr, -sql compile to wasm32-unknown-unknown (2023-era) — [PR #7633](https://github.com/apache/datafusion/pull/7633); npm `datafusion-wasm` and crate `micromegas-datafusion-wasm` 0.21.0 exist — [npm datafusion-wasm](https://www.npmjs.com/package/datafusion-wasm), [docs.rs micromegas-datafusion-wasm](https://docs.rs/crate/micromegas-datafusion-wasm/latest).

#### Polars
- js-polars (`@pola-rs/browser`): "highly experimental and is not meant for production usage", "significant startup overhead when run in the browser" from Wasm binary size and worker/threadpool spawning — [pola-rs/js-polars](https://github.com/pola-rs/js-polars). Rust Polars wasm32 builds hit compression-crate and polars-arrow build failures (2024, possibly stale) — [polars#16729](https://github.com/pola-rs/polars/issues/16729).
- Available in Pyodide: polars 1.33.1 and duckdb 1.5.1 (plus pandas 3.0.2, pyarrow 22.0.0) in the Pyodide 314.0.7 package list — [Pyodide packages](https://pyodide.org/en/stable/usage/packages-in-pyodide.html).

#### chDB (embedded ClickHouse)
- Bindings: Bun, C, C++, Go, Node.js, Python, Rust — [chdb-io](https://github.com/chdb-io). chDB v4.4.0 (11 Sep, year not shown, 2026 inferred from chdb-core ≥26.7.0) — [chDB releases](https://github.com/chdb-io/chdb/releases). v4.2.0 (2 Jul) added beta `chdb.agents.ChDBTool`: read-only at engine level, "readonly=2, keeps file()/s3()/url() usable", result cap, optional file allowlist — [chDB releases](https://github.com/chdb-io/chdb/releases). Rust binding `chdb-rust` is "experimental" (1.4.0) — [docs.rs chdb-rust](https://docs.rs/crate/chdb-rust/1.4.0/source/docs/examples.md). **Group A** (native C++, ambient file/URL/S3 table functions).

#### Others (one-liners)
- Turso Database (formerly "Limbo"): Rust rewrite of SQLite, beta; latest version conflicts (v0.6.1 2026-05-22 vs v0.8.1 2026-09-29) — [dbdb.io](https://dbdb.io/db/turso), [dev.co](https://dev.co/databases/open-source/turso). libSQL: C fork of SQLite powering Turso Cloud — same sources.
- SpotDB: containerized DuckDB SQL sandbox for agents via MCP (small, early-stage) — [Product Hunt](https://www.producthunt.com/products/spotdb-2).

### Inferences
- For code-mode, SQL engines are best treated as **tools the guest calls**, not as the guest language: DuckDB-Wasm or PGlite inside the same Wasm/V8 boundary gives Group B data processing; a native DuckDB/chDB needs a microVM (as Vercel does).
- Native SQLite is the only native engine here whose vendor explicitly targets hostile SQL and documents memory, CPU and capability controls; with ≥3.53.2, DEFENSIVE on, ATTACH=0, extensions off and authorizer it is a defensible B-conditional in-process option, but it still has had SQL-reachable heap writes as recently as 2026.
- DuckDB-Wasm's ≈12 MB gzipped (≈36 MB raw) module makes a per-session instance far heavier than SQLite Wasm or PGlite; share a compiled module across sessions and measure delta RSS per `AsyncDuckDB` instance.
- Because agentOS already runs Pyodide, DuckDB 1.5.1 and Polars 1.33.1 are reachable today with no new runtime; benchmark them as Python packages against standalone DuckDB-Wasm.

### Gaps
- No measured per-instance RSS or cold-start numbers for DuckDB-Wasm, SQLite Wasm, PGlite, or embedded DuckDB in Node/Rust.
- DuckDB-Wasm version conflict (docs 2.0.0 vs README "based on 1.5.6" vs last tagged v1.33.0) unresolved.
- Whether JSPI builds exist for DuckDB-Wasm or PGlite; DuckDB-Wasm's Node blocking API status.
- DataFusion's default object-store registry (local FS access without DDL) and query cancellation semantics not verified.
- Polars SQL/LazyFrame ambient I/O when embedded in Rust not verified.

