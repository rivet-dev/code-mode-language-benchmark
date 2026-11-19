# Python-family runtimes for sandboxed LLM-agent code (status as of 2026-11-13)

**How to read this.** Every runtime is classified as **Group B** (the runtime itself is a credible in-process boundary), **B-conditional** (capability-limited by design but weakly hardened, or only a boundary under specific embedding conditions; the reason is stated), or **Group A** (needs a separate process under OS isolation). Claims carry an inline source. Items marked **LM** are *local measurements* taken for these notes; items marked *(vendor claim)* come from the project or company that ships the runtime.

**LM conditions.** Taken 2026-11-13 on one host: AMD EPYC 7443P (24 cores/48 threads), 54 GB RAM, Linux 6.12. Node v22.23.1 and Node v26.13.1 (LTS "Lithium", released 2026-11-10, V8 14.6). Interpreters from uv's python-build-standalone builds: CPython 3.13.5, 3.14.10, 3.14.10t (free-threaded), 3.15.2, and PyPy 8.0.1 (Python 3.11.17). Also Pyodide 314.0.7 (npm), MicroPython 1.29.0-6 webassembly/pyscript variant (npm), `@pydantic/monty` 1.6.0 (npm), CPython 3.15.2 WASI build `python-3.15.2-wasi_sdk-33` on Wasmtime 50.0.1 (CLI and wasmtime-py), PocketPy 2.2.0 (gcc -O2, `PK_ENABLE_OS=0`, `PK_ENABLE_WATCHDOG=1`), RustPython 0.6.0 (`cargo install --locked --features freeze-stdlib`, release build), and starlark-pyo3 2026.1.3. Startup and import figures are medians of 5–20 runs. Speed figures (recursive `fib(25)`, and a 1e6-iteration `s += i*i` loop) are single runs, so treat them as rough tiers. Memory is the `/proc` VmRSS delta. "Marginal" means the RSS added per extra instance after GC. Scripts lived in the session scratchpad and are not preserved, so the method is described inline.

**Compact comparison table (most promising options first)**

| Runtime (version, date) | Implementation | Group | Embedding (Rust / Node) | Limits (memory / CPU) | Host calls and async (LM cost) | Marginal memory per instance | Cold / warm start | Speed vs CPython 3.14 (fib25 ms / loop ms; CPython = 6.7 / 74.5) | Compatibility and packages |
|---|---|---|---|---|---|---|---|---|---|
| **Pydantic Monty** 1.6.0 (2026-11-11) | Rust interpreter for a Python 3.14 subset | B-conditional (young; vendor says in-process aborts take down the host) | crate `monty` (in-process) and `monty-pool`; npm `@pydantic/monty` (subprocess workers or Wasm in worker_threads); PyPI `pydantic-monty` | `max_memory`, feed and turn duration, recursion 1000, suspensions 1000 | sync and async external functions, `asyncio.gather`; ≈63 µs per call through a native worker, ≈130–140 µs through the Wasm worker | ≈9.5 MB RSS per worker process (vendor: ≈2 MB); ≈38 MB per Wasm worker thread | pool 3 ms, checkout 1.4 ms, feed 0.2 ms (LM); vendor: 0.8 ms from a warm pool | 42 / 49 (native worker); 58 / 119 (Wasm) | subset: no inheritance, `yield`, or `del`; partial stdlib; no third-party packages |
| **Pyodide** 314.0.7 (2026-09-14) | CPython 3.14.2 on Emscripten/Wasm | B-conditional (ctypes reaches the host JS realm; verified LM) | npm `pyodide` (Node, Deno, Bun, workerd); Rust only through V8 (aardvark-core, experimental) | no memory-cap API found; interrupt buffer, or terminate the worker | JS FFI sync ≈0.8 µs; awaiting a JS promise ≈39 µs (Node 22) / ≈63 µs (Node 26); `run_sync` needs JSPI | 41–43 MB in one isolate; 71–78 MB per worker_thread; 48–51 MB when restored from a snapshot | 1.3–1.85 s fresh; 146–183 ms from a 30 MB memory snapshot | 21 / 202–242 | full stdlib (`ssl` is a stub); 357 packages including numpy 2.4.6, pandas 3.0.2, matplotlib 3.10.8, pyarrow, polars, duckdb |
| **CPython 3.15.2 on WASI** (wasip1 build, 2026-10-27) on Wasmtime 50.0.1 | CPython interpreter compiled to Wasm | B | `wasmtime` crate; Node via WASI hosts; componentize-py; eryx | Wasmtime fuel and epoch interruption, 512 KiB default Wasm stack, pooling allocator | through Wasm imports or WIT only; no sockets in WASI 0.1 | ≈7.8 MB in-process without pre-init (LM) | CLI with precompiled module 56 ms (35 ms with `-I -S`); in-process 126 ms; ≈16–18 ms with pre-init (eryx, vendor) | 20.7 / 298 | stdlib without zlib, ssl, sqlite3, lzma, bz2, or ctypes in this build; numpy experimental |
| **eryx** 0.15.0 (2026-11-13) | CPython 3.14 WASI (componentize-py) on Wasmtime with pre-init | B-conditional (two high-severity advisories in 2026-10) | crate `eryx`; PyPI `pyeryx`; npm `@bsull/eryx` | "memory and CPU limits", epoch interruption | async callbacks, `asyncio.gather` | unknown | ≈16–18 ms per sandbox with pre-init or precompile; ≈1.6 ms per execution (vendor) | ≈ CPython-WASI | pure-Python wheels; numpy experimental (`native-extensions`) |
| **MicroPython** 1.29.0 webassembly (npm 1.29.0-6, 2026-08-24) | C bytecode VM on Emscripten | B-conditional (the `js` FFI exposes the host realm; one instance per realm) | npm; also a native C library | `heapsize`; no interrupts in browsers | `registerJsModule`, await JS promises; sync ≈1.07 µs, async ≈52 µs | ≈0.8 MB | 43 ms first, 7.8 ms after | 168 / 994 | Python 3.4 level; json, re, datetime, asyncio, hashlib; no pandas |
| **PocketPy** 2.2.0 (2026-09-04) | C11 VM | B-conditional (C, OS module on by default, no memory cap found) | single C file; no Rust or Node bindings found | compile-time watchdog timeout; no memory cap found | C API | ≈0.72 MB per VM (16 VMs per process at most) | init 3.7 ms; new VM 2.1 ms | 31.8 / 61.7 | subset; `re`, `io`, `hashlib`, `asyncio`, `itertools` absent from this build |
| **Starlark** (starlark-rust 0.14.2, 2026-06-05; starlark-go, 2026-10-21 commit) | Rust and Go interpreters | B-conditional (no memory cap; Rust step limit undocumented) | crate `starlark`; Go module; starlark-pyo3 | Go: `SetMaxExecutionSteps`, `Cancel`; Rust: recursion guard | synchronous host builtins; no async | about a KB per module (LM, in the noise) | ≈0.07 ms per tiny module (LM); vendor: 1.3 ms first eval | n/a / 211 | Python-like configuration language, not Python |
| **RustPython** 0.6.0 (2026-10-02) | Rust interpreter (experimental JIT) | A by default (os, socket, subprocess, and ctypes import); B only if run inside Wasm | crates `rustpython`, `rustpython-vm` | none documented | Rust API | ≈50 MB CLI peak RSS | 74 ms (60 ms with `-I -S`) | 39.7 / 217 | broad stdlib; reports `3.14.0.alpha`; "not totally production-ready" |
| **Native CPython** 3.14.10 / 3.15.2 | interpreter (experimental JIT) | A | PyO3 0.30.1; subprocess | OS-level only | anything | 12.1 MB idle; ≈105 MB with numpy, pandas, and matplotlib; 3.45 MB USS per child forked from a preloaded zygote | 27–29 ms (20–22 ms with `-I -S`) | 6.7 / 74.5 (3.14), 11.3 / 96 (3.15) | full |
| **PyPy** 8.0.1 (2026-10-14) | tracing JIT | A | subprocess | OS-level only | anything | 57.8 MB idle | 57 ms | 11.6 / 1.35 | Python 3.11 (3.12 beta); numpy and pandas wheels installed |
| **Cloudflare Python Workers** (GA 2026-09) | Pyodide in workerd isolates with deploy-time snapshots | B (hosted platform) | hosted only | 128 MB per isolate; CPU-time limits | JS FFI, `fetch`, bindings | n/a | ≈1.0 s cold for a FastAPI, httpx, and pydantic app (vendor) | ≈Pyodide | Pyodide packages |

**One-line catalog of every other Python-family option found**

| Runtime | Status (date) | Group | One-line note |
|---|---|---|---|
| mcp-run-python (Pydantic; Deno + Pyodide) | archived 2026-01-30 | B-conditional | Retired because "there's just no safe way to run Python within pyodide safely with reasonable latency"; points to Monty |
| langchain-sandbox (Deno + Pyodide) | archived 2026-01-14; last release 0.0.6 (2025-05-21) | B-conditional | One of the seven products in Cyera's Pyodide research |
| smolagents WasmExecutor (Deno + Pyodide) | added in v1.20.0, removed in v1.26.0 (2026-05) | B-conditional | Removed as the fix for CVE-2026-10613 |
| Cohere Terrarium (Pyodide) | archived; ctypes path unpatched | B-conditional | CVE-2026-61522 (CVSS 9.3) |
| n8n Python Code node (Pyodide) | replaced by task runners in n8n 2.0 | was B-conditional | CVE-2025-68668 (CVSS 9.9), "N8Scape" |
| Grist formulas (Pyodide) | Pyodide under Deno by default since 1.7.9 (2026-01-09), or gVisor | B-conditional | CVE-2026-24002 (CVSS 9.1), "Cellbreak" |
| aardvark-core 0.3.0 (Rust + V8 + Pyodide) | experimental (2026-11-06) | B-conditional | Warm Pyodide snapshots and per-isolate heap and RSS guards; "not a production-hardening claim" |
| JupyterLite xeus-python / emscripten-forge | active | B-conditional | Conda-packaged alternative to Pyodide's package set; browser-focused |
| componentize-py 0.25.1 | active (2026-09-12) | B (inherits its Wasm host) | Builds WASI components from Python; dependencies can only be imported at build time |
| Wasmer Python on WASIX, plus the Wasmer SDK | Wasmer 7.0 (2026-01-30); SDK posted 2026-09-01 | B-conditional | Dynamic linking enables native wheels; WASIX index lists 220–435 packages, including pandas and matplotlib |
| py2wasm (Wasmer, Nuitka-based AOT) | stale since 2024-06; Python 3.11 only | B | Vendor pystone result is ≈70% of native |
| Monty Commercial Support server | commercial | B with OS isolation | gRPC remote workers; an escape reaches "an empty container" |
| monty-go (Monty via WASM on wazero), gomonty, dart_monty, langchain-monty | community and integrations | as Monty | Shows Monty compiles to Wasm and is being adopted |
| starlark-python (dbohdan) | unknown | B-conditional | Python port of Starlark with opt-in `max_steps` and `max_allocs` (search snippet only) |
| Brython 3.15.0 (npm, 2026-10-10) | active | B if run in a capability-free JS isolate | Python-to-JS in the browser; unproven for server-side sandboxing |
| Skulpt (npm 1.2.0, 2021) | possibly stale | B if run in an isolate | Python-in-JS; package data older than 2024 |
| smolagents LocalPythonExecutor (1.26.0) | active | A | AST interpreter inside the host CPython; CVE-2025-5120 |
| RestrictedPython 9.0 (2026-11-04) | active | A | Six advisories, including 2026 escapes |
| asteval 1.0.10 / simpleeval 1.0.8 | active | A | Repeated sandbox-escape CVEs in 2025–2026 |
| CPython subinterpreters (`concurrent.interpreters`, 3.14+) | stdlib | A | Docs: "do not use multiple interpreters in security-sensitive situations" |
| PyPy sandbox | unmaintained (only date referenced is 2019) | A | Old syscall-proxy design, tested with PyPy2 |
| GraalPy (graal-25.5.5, 2026-11-03; Python 3.12.8) | active | A | GraalVM sandbox policies are documented only for JavaScript |
| CPython 3.14t (free-threaded) | official build variant (uv ships it) | A | +3 MB idle RSS versus the default build (LM) |
| Docker, microVM, and sandbox services (E2B, Daytona, Modal, Blaxel) running CPython | active | A with host isolation | Vendor-measured: Docker new sandbox 195 ms; a sandbox service 1500 ms |

## Q1. Pyodide: version, startup and memory with and without snapshots, packages, async model, per-instance overhead, HTTP; Cloudflare Python Workers, mcp-run-python, LangChain sandbox, and other Pyodide hosts

### Takeaway
Pyodide 314.0.7 (CPython 3.14.2) is the compatibility leader inside a JS host. The LM cost is 1.3–1.85 s and about 41–43 MB per fresh instance in one isolate, 146–183 ms and about 48–51 MB when restored from a memory snapshot, and roughly 3× slower pure-Python code than native. It is **not** an in-process boundary in a Node.js realm: `ctypes.CDLL(None)` reaches `system()` (host shell via `child_process.spawnSync`) and `emscripten_run_script_string` (host `eval`). This was verified locally on Pyodide 314.0.7 / Node 26 even with `js` and `pyodide_js` blocked. Seven products shipped escapes through this path, and Pydantic and LangChain archived their Pyodide sandboxes.

### Cited Findings

#### Runtime record: Pyodide
- **(1) Identity.** CPython compiled with Emscripten to Wasm, a bytecode interpreter. npm `latest` = **314.0.7 (2026-09-14)**, `next` = 315.0.0-alpha.2, with maintenance lines `stable-0.29` = 0.29.5 and `stable-0.27` = 0.27.8 (both 2026-09-15) — [npm registry](https://registry.npmjs.org/pyodide); [changelog](https://pyodide.org/en/stable/project/changelog.html). License MPL-2.0 — [npm registry](https://registry.npmjs.org/pyodide). Active: the repo was pushed 2026-11-13 — [GitHub](https://github.com/pyodide/pyodide).
  - 314.0 (2026-06-09) switched to Python-aligned versioning, with "a new major Pyodide version annually, synchronized with Python updates." It ships Python 3.14.2 and Emscripten 5.0.3 — [Pyodide 314.0 release](https://blog.pyodide.org/posts/314-release/).
  - 314.0.6 fixed stack-switching regressions, and 314.0.5 fixed thread-state issues around `run_sync` — [changelog](https://pyodide.org/en/stable/project/changelog.html).
  - Shipped artifact sizes: `pyodide.asm.wasm` 9.6 MB, `pyodide.asm.mjs` 1.25 MB, `python_stdlib.zip` 2.5 MB — LM (npm tarball).
- **(2) Group: B-conditional.** It is a Group-A risk in any realm with Node APIs.
  - The Emscripten glue in 314.0.7 implements `__emscripten_system` as `require("node:child_process").spawnSync(cmd, [], {shell: true})` when `ENVIRONMENT_IS_NODE`, and `_emscripten_run_script_string` as `eval(...)` — LM (grep of `pyodide.asm.mjs`).
  - LM verification on Node v26.13.1: with `sys.modules['js']` and `sys.modules['pyodide_js']` set to `None`, `ctypes.CDLL(None).system(b"echo ... > file")` returned 0 and wrote the file. `emscripten_run_script_string(b"typeof process + ':' + process.version")` returned `object:v26.13.1`.
  - Cyera's DEF CON 34 research (2026-08-07) found escapes in seven Pyodide products: n8n CVE-2025-68668 (9.9), Grist CVE-2026-24002 (9.1), cohere-terrarium CVE-2026-61522 (9.3), smolagents CVE-2026-10613 (8.3), langchain-sandbox, stlite, and cibuildwheel. The common flaw: "ctypes remained available and the relevant symbols could be resolved," giving access to `emscripten_run_script_string`, `system`, `popen`, and `execve`. Mitigations: restrict ctypes and `_ctypes`, strip dangerous exports ("An FFI control is only effective if the dangerous symbol is unavailable"), and use a separate process or container — [Cyera](https://www.cyera.com/research/sandcastles-not-sandboxes-how-one-architectural-flaw-exposed-seven-products); [eSecurityPlanet](https://www.esecurityplanet.com/threats/def-con-34-one-pyodide-flaw-exposed-seven-products/).
  - n8n blocked `os.system`, `sys.modules['js']`, and `Object.constructor.constructor`, but left `ctypes` and `_pyodide._base.eval_code` open. Cyera: "function-level blocking is not capability-level isolation" — [Cyera N8Scape](https://www.cyera.com/research/n8scape-pyodide-sandbox-escape-9-9-critical-post-auth-rce-in-n8n-cve-2025-68668).
  - Grist: "traversal through Python's class hierarchy and leaves ctypes available," reaching "Emscripten runtime functions"; the fix runs Pyodide under Deno by default — [The Hacker News](https://thehackernews.com/2026/01/critical-grist-core-vulnerability.html).
  - Pydantic, on archiving mcp-run-python: Pyodide code "can run arbitrary javascript," and "Deno has no good way to limit memory use" — [mcp-run-python](https://github.com/pydantic/mcp-run-python).
  - Monty's comparison rates Pyodide's security as "poor" — [Monty alternatives](https://pydantic.dev/docs/monty/reference/alternatives/).
- **(3) Embedding.** npm `pyodide` for Node, Deno, and Bun, and inside workerd (Cloudflare).
  - Since 314.0, classic workers are unsupported, and module workers with `pyodide.asm.mjs` are required — [314.0 release](https://blog.pyodide.org/posts/314-release/).
  - For a Rust host, aardvark-core 0.3.0 (2026-11-06) runs Pyodide inside V8 (`v8 = 149.2.0`) with warm snapshots and per-isolate heap and RSS guard rails. It is experimental and "not a production-hardening claim" — [docs.rs aardvark-core](https://docs.rs/crate/aardvark-core/latest).
- **(4) Resource controls.**
  - `setInterruptBuffer(TypedArray)` delivers signals (SIGINT raises `KeyboardInterrupt`), and `checkInterrupt()` lets JS code poll — LM (`pyodide.d.ts` of 314.0.7).
  - No per-instance memory-cap API was found (see Gaps). Deno has "no good way to limit memory use" — [mcp-run-python](https://github.com/pydantic/mcp-run-python).
- **(5) Host calls and async.**
  - JS functions placed in `globals` are called synchronously. `runPythonAsync` gives top-level await, and Python can `await` JS promises.
  - `pyodide.ffi.run_sync()` "suspends execution until the given awaitable is completed" and works only with JSPI. Stack switching is enabled under `runPythonAsync`, async Python functions, and `callPromising()`, but not under `runPython()` — [Pyodide JSPI post](https://blog.pyodide.org/posts/jspi/).
  - Node ≤24 needs `--experimental-wasm-stack-switching` or `--experimental-wasm-jspi` — [314.0 release](https://blog.pyodide.org/posts/314-release/); [JSPI post](https://blog.pyodide.org/posts/jspi/).
  - LM: `can_run_sync()` is `false` on Node 22 without a flag, `true` on Node 22 with `--experimental-wasm-jspi`, and `true` by default on Node 26.13.1.
  - LM per-call cost: a sync JS call from Python takes 0.82–0.85 µs. A serial `await` of an async JS function takes 39 µs (Node 22, no JSPI), 385 µs (Node 22 with the experimental JSPI flag), or 63 µs (Node 26, JSPI default).
  - LM concurrency: `asyncio.gather` over 1000 host promises that each resolve after 100 ms finished in 139 ms (Node 22 and Node 26) or 222 ms (Node 22 with the flag), with no measurable RSS growth (0–0.4 MB).
  - 314.0 changes: `callPromising()` and `runPythonAsync()` "now always yields to the event loop once before Python begins executing," and a stack-memory leak in stack switching was fixed — [changelog](https://pyodide.org/en/stable/project/changelog.html).
- **(6) HTTP.**
  - `pyfetch` gained custom fetchers in 0.28 and accepts a JS `Request` in 0.29. 0.29 added `pyxhr`, a synchronous client — [changelog](https://pyodide.org/en/stable/project/changelog.html).
  - urllib3 (and therefore requests) uses fetch, with an XMLHttpRequest fallback. Node support relies on JSPI, and the support is "experimental", with Node "very experimental". There are no proxies and no custom TLS — [urllib3 docs](https://urllib3.readthedocs.io/en/stable/reference/contrib/emscripten.html).
  - 314.0 added **experimental raw sockets in Node** through `pyodide.useNodeSockFS()` (TCP with TLS, tested with pymysql, pg8000, and redis-py), and replaced `ssl` with a stub that has no real TLS — [314.0 release](https://blog.pyodide.org/posts/314-release/).
  - A urllib3 maintainer noted the Emscripten backend is out of scope for its security policy, citing CVE-2025-50182 as a behavior difference after routing through fetch — [InfoQ](https://infoq.com/news/2026/09/cloudflare-python-workers-ga).
- **(7) Footprint, LM, Pyodide 314.0.7.**
  - Node 22.23.1: the first `loadPyodide()` takes 1848 ms, later ones 1593–1667 ms. Baseline RSS was 43 MB; after one instance 147 MB, and **41 MB marginal per extra instance** (10 instances in one isolate).
  - Node 26.13.1: 1296–1663 ms per load and **42.8 MB marginal per instance**.
  - One Pyodide per `worker_thread` (separate isolate, json, re, and datetime imported): **70.9 MB (Node 22) / 77.7 MB (Node 26) per worker, including the worker isolate itself**. An empty worker alone costs 10.5 / 8.2 MB. Load took ≈1.5 s inside the worker.
  - Memory snapshot (`loadPyodide({_makeSnapshot: true})`, then `makeMemorySnapshot()`, then `loadPyodide({_loadSnapshot})`, all marked `@private` or `@ignore` in the typings): after importing json, re, datetime, and asyncio, the snapshot was **30.0 MB** and took 1.4–1.5 s to make. **Restore took 146–183 ms per instance and 48–51 MB marginal RSS**, more than a fresh instance because the whole snapshotted heap is resident.
  - Vendor and other measurements: Monty's comparison measured 2700 ms for a new Pyodide sandbox through mcp-run-python 0.0.22 (Deno 2.5.5, Pyodide 0.28.2, M3 Max) and 35 ms for a warm 10-command agent run; the npm package is about 12 MB and Deno about 50 MB — [Monty alternatives](https://pydantic.dev/docs/monty/reference/alternatives/).
- **(8) Speed (LM).** `fib(25)` took 21.0 ms (versus 6.7 ms on native 3.14, about 3.1× slower). The 1e6 loop took 242 ms on Node 22 and 202 ms on Node 26 (versus 74.5 ms, about 2.7–3.3× slower).
- **(9) Snapshot and resume.**
  - Memory snapshots capture Wasm linear memory after initialization. They are private API in Pyodide and productized by Cloudflare (below).
  - No mid-execution snapshot of a suspended coroutine was found (see Gaps).
- **(10) Ecosystem fit.**
  - The 314.0.7 lockfile (`abi_version 2026_0`, `emscripten_5_0_3`, Python 3.14.2) lists **357 packages**, including numpy 2.4.6, pandas 3.0.2, matplotlib 3.10.8, pillow 12.2.0, scipy 1.18.0, pyarrow 22.0.0, polars 1.33.1, duckdb 1.5.1, lxml, cryptography 47.0.0, httpx, requests, urllib3 2.6.3, aiohttp, pydantic 2.12.5, orjson, regex, beautifulsoup4, scikit-learn 1.8.0, sympy, networkx, shapely, opencv-python, sqlalchemy, zstandard, and brotli — LM (`pyodide-lock.json`).
  - Absent from the lockfile: openpyxl, xlsxwriter, pypdf, python-docx, and reportlab. These would need micropip from PyPI or vendoring — LM.
  - 0.28 had dropped 14 packages, including duckdb, polars, and pyarrow; they are present again in 314.0.7 — [changelog](https://pyodide.org/en/stable/project/changelog.html); LM.
  - PEP 783 is accepted, so `pyemscripten_2026_0` wheels can be published to PyPI, and cibuildwheel v4 supports them — [314.0 release](https://blog.pyodide.org/posts/314-release/).
  - 314.0 restored `ssl`, `sqlite3`, and `lzma` to the stdlib, added `compression.zstd`, and dropped OpenSSL (so some hashlib algorithms are gone) — [314.0 release](https://blog.pyodide.org/posts/314-release/).
  - LM package cost on Node 26 (from a local package cache):
    - numpy: `loadPackage` 389 ms plus import 387 ms, +40 MB. On Node 22: 475 + 440 ms, +40 MB.
    - pandas: 524 ms plus import 1987 ms, +178 MB. On Node 22: 762 + 2253 ms, +132 MB.
    - matplotlib: 481 ms plus import and one plot 1949 ms, +64 MB. On Node 22: 505 + 2267 ms, +87 MB.
    - Compare native CPython 3.14 imports: numpy 63 ms (+18 MB), pandas 242 ms (+61 MB), and matplotlib.pyplot 351 ms (+57 MB) (Q6).
- **(11) Production users running untrusted code.**
  - Cloudflare Python Workers (below).
  - Grist, under Deno or gVisor — [The Hacker News](https://thehackernews.com/2026/01/critical-grist-core-vulnerability.html).
  - n8n moved Python to external runners — [Cyera](https://www.cyera.com/research/sandcastles-not-sandboxes-how-one-architectural-flaw-exposed-seven-products).

#### Runtime record: Cloudflare Python Workers (a Pyodide host)
- GA in 2026-09. Bindings include D1, R2, Durable Objects, Queues, and Workflows. FastAPI, Django, and Flask work through `workers.asgi` and `workers.wsgi`. requests and httpx route through JS fetch. aiomysql and asyncpg work through a socket bridge over the Workers connect API. Compatibility flags select Python 3.12, 3.13, or 3.14 (older versions lack JSPI) — [InfoQ](https://infoq.com/news/2026/09/cloudflare-python-workers-ga).
- **Snapshots.** At deploy, Cloudflare runs top-level scope and snapshots Wasm linear memory. The function-pointer table and JS-reference table are handled separately, and dynamic libraries such as numpy are reloaded in the same order.
  - `crypto.getRandomValues()` is disabled during startup and hash seeds are fixed per Worker. A "poison seed" fails deployment if the PRNG is used during init, and the PRNG is reseeded after restore.
  - A FastAPI, httpx, and pydantic Worker starts in about 10 s without a snapshot and about 1 s with one. Mean cold start was 1.027 s, versus 2.502 s on Lambda without SnapStart and 3.069 s on Cloud Run (vendor claim; post dated 2025-12-08, modified 2026-07-15) — [Cloudflare blog](https://blog.cloudflare.com/python-workers-advancements).
- Wasmer's CEO claims ≈60 ms for a minimal Python app on Wasmer Edge versus ≈900 ms on Workers (competitor claim) — [InfoQ](https://infoq.com/news/2026/09/cloudflare-python-workers-ga).
- **Limits.** 128 MB per isolate "including the JavaScript heap and WebAssembly allocations"; global scope must finish in 1 s; 64 MiB Worker size — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- The Pyodide version is tied to the compatibility date — [How Python Workers work](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/).
- **Group B** as a hosted platform (V8 isolates plus Cloudflare's own hardening); not embeddable as a library.

#### Other Pyodide hosts
- **mcp-run-python** (Deno + Pyodide): archived 2026-01-30, last release v0.0.22 (2025-12-11). It pointed users to Monty — [GitHub](https://github.com/pydantic/mcp-run-python).
- **langchain-sandbox**: archived 2026-01-14, last release 0.0.6 (2025-05-21) — LM (GitHub API). Listed among Cyera's seven products — [Cyera](https://www.cyera.com/research/sandcastles-not-sandboxes-how-one-architectural-flaw-exposed-seven-products).
- **smolagents WasmExecutor** (Pyodide + Deno): added in v1.20.0 — [HF post](https://huggingface.co/posts/albertvillanova/918618201277855). Removed in v1.26.0 — [releases.sh](https://releases.sh/hugging-face/smolagents) — as the fix for CVE-2026-10613 — [Cyera](https://www.cyera.com/research/sandcastles-not-sandboxes-how-one-architectural-flaw-exposed-seven-products).
- **JupyterLite xeus-python with emscripten-forge**: a separate conda-based Wasm Python distribution. pip installs are experimental and limited to pure-Python packages — [jupyterlite-xeus docs](https://jupyterlite-xeus.readthedocs.io/en/stable/environment.html).

### Inferences
- **High priority for agentOS.** The prior note says agentOS blocks `js` and `pyodide_js`. That is the same pattern that failed in n8n, Grist, and five other products. Unless agentOS also removes `ctypes` and `_ctypes` and the Emscripten `system`, `popen`, `execve`, and `emscripten_run_script*` exports, or runs the Emscripten module in a realm with no `require` or `process`, guest Python can reach the Node host. I did not inspect agentOS's current `driver.ts` here; verify it against the LM test above.
- Pyodide becomes a credible Group B option only inside a capability-free JS realm, such as workerd or a bare V8 isolate like agentOS's own guest-JS isolates, with ctypes stripped. Running it in a Node `worker_thread` gives memory separation, not authority separation.
- Per-session cost favors one shared isolate (≈42 MB per instance) over one worker per session (≈71–78 MB). Snapshots trade a 30 MB blob and ≈48–51 MB of resident memory for about 10× faster start (≈150 ms versus ≈1.5 s). The resident cost could likely shrink if restored memory were mapped copy-on-write, but V8 copies the snapshot into each instance's memory (inference).
- For code mode, the async path is cheap: 1000 parallel host calls add no measurable memory, and each await costs tens of µs. Pandas-heavy sessions cost about 0.2 GB and about 2.5–3 s of import time per instance.

### Gaps
- No official Pyodide statement on its security model was found; the docs page was not reachable through search.
- No per-instance memory-cap API was confirmed. A 2 GB Wasm32 limit appears only in an older StackOverflow-derived snippet, which is unverified.
- `makeMemorySnapshot` is private and undocumented. Behavior with numpy or pandas loaded before the snapshot, and JS-reference restrictions outside workerd, were not tested.
- The memory cost per suspended JSPI stack (each `run_sync`) is not published, and only `asyncio.gather` concurrency was measured.
- No independent measurement of Python Workers per-isolate memory exists. The "tens of MBs" comment is speculation — [InfoQ](https://infoq.com/news/2026/09/cloudflare-python-workers-ga).

## Q2. Pydantic Monty and similar Python-subset interpreters built for code mode

### Takeaway
Monty went from 0.0.1 (2026-01-27) to 1.0.0 (2026-09-25) and 1.6.0 (2026-11-11). It is the only purpose-built code-mode Python found. LM costs: ≈0.2 ms per snippet, ≈63 µs per host call through its native worker process, ≈9.5 MB RSS per worker, and kilobyte-scale serializable snapshots. Its weaknesses are a deliberately partial language and stdlib with no third-party packages. Pydantic also steers users away from in-process mode: the Python and JS bindings only run Monty in subprocesses or Wasm workers. No comparable second code-mode interpreter was found; smolagents' AST executor, Starlark, PocketPy, and MicroPython are the nearest substitutes.

### Cited Findings

#### Runtime record: Pydantic Monty
- **(1) Identity.** "A secure Python sandbox, written in Rust, for code written by AI"; an "MIT licensed Python 3.14 sandbox" — [README](https://github.com/pydantic/monty).
  - PyPI release history: 0.0.1 on 2026-01-27, 1.0.0 on 2026-09-25, then 1.1–1.6 between 2026-10-05 and 2026-11-11 — [PyPI](https://pypi.org/project/pydantic-monty/).
  - The crates `monty` and `monty-pool` are at 1.6.0, and npm `@pydantic/monty` is at 1.6.0 — LM (registries). The repo has 8.9k stars and was pushed 2026-11-13 — LM (GitHub API).
  - The repo contains a `fuzz` crate and a `monty-wasm-runtime` crate — LM (GitHub API).
  - Whether it is tree-walking or a bytecode VM is not stated on the pages fetched.
- **(2) Group: B-conditional.**
  - "Monty is a language-level sandbox, not an OS-level one." It has no ambient authority: no files, environment, sockets, or processes unless the host passes them in. Wall clock and entropy are configurable — [security](https://pydantic.dev/docs/monty/concepts/security/).
  - The in-process crate: "an abort in the sandbox is an abort in your process." The heap arena and refcounting are "among the most security-critical areas." "After a memory or time limit fires, no guarantees are made about heap state or reference counts." The Python and JS APIs "do not offer an in-process execution mode" — [security](https://pydantic.dev/docs/monty/concepts/security/).
  - The README says a worker "can never be made fully crash-proof" against memory errors from adversarial input — [PyPI](https://pypi.org/project/pydantic-monty/).
  - There is a bounty program and private advisories — [security](https://pydantic.dev/docs/monty/concepts/security/). No published GitHub advisories as of 2026-11-13 — LM (GitHub API).
  - The reasons for B-conditional are that it is less than a year old and that the vendor itself recommends process isolation. The Wasm build (`@pydantic/monty/wasm`, monty-go on wazero) runs inside a Wasm boundary, which makes it Group B at higher memory cost — [monty-go](https://github.com/fugue-labs/monty-go).
- **(3) Embedding.**
  - Rust: `monty` (in-process) or `monty-pool` (recommended).
  - Node: `@pydantic/monty`. "Node uses subprocess workers, or remote workers over gRPC… `@pydantic/monty/wasm` uses Node worker threads or browser Web Workers." The native package ships a 32 MB `monty` worker binary and a 10 MB `.node` addon — LM (npm package).
  - Python: `pydantic-monty`.
  - Community bindings for Go (gomonty) and Dart (dart_monty) — [README](https://github.com/pydantic/monty). A LangChain middleware also exists — [langchain-monty](https://pypi.org/project/langchain-monty/4.0.0/).
- **(4) Resource controls.**
  - `max_memory` counts bytes requested from the allocator. Feed and turn duration limits are checked cooperatively, with a host backstop, and do not count host time.
  - `max_recursion_depth` defaults to 1000. `max_suspensions` defaults to 1000 per checkout. `max_total_sleep` also exists, and print output is capped at 10 MiB.
  - The GC runs every 100k allocations. There is **no instruction-count limit**. CPU-clock mode is Linux-only for subprocess workers — [resource limits](https://pydantic.dev/docs/monty/concepts/resource-limits/).
  - Pydantic AI's defaults per `run_code`: 30 s, 256 MiB, and 100 nested tool calls — [Code mode is not a sandbox](https://pydantic.dev/articles/code-mode-vs-sandboxes).
- **(5) Host calls and async.**
  - External functions are passed through `external_lookup`, and host objects are exposed through `ClassInstance`/`ClassType` allowlists. `ExternalModule` exposes a host module with a `.pyi` stub, and a bundled `ty` type-checks snippets — [PyPI](https://pypi.org/project/pydantic-monty/).
  - `feed_start` pauses at external calls, OS calls, name lookups, and futures. `FutureSnapshot` resolves concurrent host futures, and `AsyncMonty` awaits coroutine host functions — [snapshots](https://pydantic.dev/docs/monty/concepts/snapshots/).
  - Pydantic AI renders tools as `async def`, and `asyncio.gather` is supported, but only `run`, `gather`, and `sleep` exist in `asyncio` — [code mode](https://pydantic.dev/docs/ai/harness/code-mode/); [limitations](https://pydantic.dev/docs/monty/limitations/).
  - The npm option `streamAsyncCalls` lets un-awaited async calls go to the host without a round trip; it is off by default — LM (`pool.d.ts`).
  - **LM (Node 22, native subprocess worker):**
    - `feedRun` median 0.20 ms; first feed 4.7 ms.
    - Sync host call ≈62.7 µs and async host call ≈63.8 µs each (one IPC round trip per suspension).
    - 1000 concurrent 100 ms host calls through `asyncio.gather` took 161 ms (with `maxSuspensions` raised).
  - **LM (Wasm in worker_threads):** feed 0.27 ms, host call ≈129–141 µs, gather of 1000 calls 233 ms.
- **(6) HTTP.** None inside the sandbox. All network access goes through host functions, which "must be validated like any untrusted input" — [security](https://pydantic.dev/docs/monty/concepts/security/).
- **(7) Footprint.**
  - Vendor: "about 2 MB baseline per worker plus its memory limit"; package ≈4.5 MB; 0.8 ms for a new sandbox from a running pool (5 ms for a new pool); snapshots are "a few kilobytes". Measured on an M3 Max, 2026-09-03, `pydantic-monty` 1.0.0b3 — [alternatives](https://pydantic.dev/docs/monty/reference/alternatives/).
  - LM: pool creation 3.0 ms, first checkout 1.4 ms, later checkouts 0.63 ms. 11 worker processes totaled 107.6 MB, ≈9.5 MB RSS per session (RSS includes the shared 32 MB binary's resident pages, so PSS would be lower).
  - LM, Wasm mode: pool 340 ms, ≈130 ms per new worker, ≈38 MB parent-RSS per worker thread.
- **(8) Speed (LM).** `fib(25)`: 41.8 ms native worker, 58.1 ms Wasm (≈6–9× slower than CPython 3.14's 6.7 ms). 1e6 loop: 49.2 ms native, faster than CPython's 74.5 ms, and 119 ms Wasm.
- **(9) Snapshot and resume.** `dump()` creates a session dump between feeds, or a snapshot mid-feed with the paused call stack.
  - The format is a `MONTY\0` magic header, a format version, and CBOR, capped at 256 MiB.
  - Snapshots restore "in another process, or on another machine". Snapshots are not authenticated, mounts must be re-supplied, and newer dumps are refused by older builds — [snapshots](https://pydantic.dev/docs/monty/concepts/snapshots/).
- **(10) Ecosystem fit.**
  - Supported: closures, decorators, simple classes, `@dataclass` (only `eq=` and `frozen=`), comprehensions, `try`/`except`/`finally`, `match`, f-strings, async/await, and imports.
  - **Rejected:** inheritance, metaclasses, method decorators (`@property`, `@classmethod`, `@staticmethod`), `yield`, `del`, `async with`, `async for`, and wildcard imports. User-defined exceptions and `super` are missing.
  - Stdlib (partial): asyncio, base64, collections, csv, dataclasses, datetime, decimal, functools, hashlib, itertools, json, math, os/pathlib (through mounts), random, re (Rust `fancy-regex`, no bytes patterns), statistics, time, tomllib, typing, unicodedata.
  - Absent: enum, contextlib, io, string, struct, operator, logging, uuid, urllib. Third-party packages are unavailable ("no `sys.path`") — [limitations](https://pydantic.dev/docs/monty/limitations/).
  - Files are available through `cap_std` mounts — [security](https://pydantic.dev/docs/monty/concepts/security/).
- **(11) Production users.**
  - Pydantic AI Code Mode, where `run_code` runs in Monty workers on the agent's machine — [Code mode is not a sandbox](https://pydantic.dev/articles/code-mode-vs-sandboxes).
  - A commercial remote server (gRPC, container image): "Commercial Support's escape reaches an empty container" — [alternatives](https://pydantic.dev/docs/monty/reference/alternatives/).

#### Vendor comparison table worth reusing (Pydantic, 2026-09-03, M3 Max, CPython 3.14.7)
New sandbox and warm 10-command agent run:

| Option | New sandbox | Warm 10-command agent run |
|---|---|---|
| OSS Monty | 0.8 ms | 0.4 ms |
| Docker | 195 ms | 700 ms |
| Pyodide (mcp-run-python) | 2700 ms | 35 ms |
| starlark-rust (starlark-pyo3 2026.1.1) | 1.3 ms | n/a |
| WASI/wasmtime (CPython 3.14.7 WASI, wasmtime-py 48) | 16 ms | 180 ms |
| Sandboxing service | 1500 ms | 400 ms |
| Plain `exec()` | ≈0.1 ms | n/a |
| Plain subprocess | ≈30 ms | n/a |

WASI also measured ≈1.5 ms to deserialize a precompiled module, 95 ms from the wasmtime cache, and 340 ms compiling from scratch — [alternatives](https://pydantic.dev/docs/monty/reference/alternatives/).

#### Similar interpreters
- A targeted search found no second Python-subset interpreter built specifically for code mode. Results pointed back to Monty, Pyodide, MicroPython, and container sandboxes — [search-based; e.g., victorstack](https://victorstack-ai.github.io/agent-blog/2026-02-07-pydantic-monty-wasm/).
- smolagents' `LocalPythonExecutor` is the closest earlier design: an AST interpreter with an import allowlist and an operation cap, running inside host CPython (Group A; see Q5) — [smolagents docs](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution).

### Inferences
- For "short script that calls host tools serially and in parallel," Monty's measured overhead is the lowest of any Python option: 0.2 ms per feed and tens of µs per tool call, with KB snapshots that make durable suspension practical.
- Benchmark Monty both through the Rust `monty` crate in-process (no IPC, so host calls should drop well below 63 µs; inference) and through `monty-pool` or npm subprocesses (the vendor-recommended shape).
- The main risk is LLM-written code hitting unsupported features (inheritance, generators, `del`, `contextlib`, `enum`). The benchmark should include a "compatibility hit rate" on real agent transcripts.
- Monty's default `max_suspensions` of 1000 per checkout, and Pydantic AI's 100 nested tool calls, will cap loops over large tool fan-outs. Size these deliberately.

### Gaps
- Monty's in-process (crate) per-session memory and host-call cost were not measured; only Node subprocess and Wasm modes were.
- PSS (shared-page-adjusted) memory per Monty worker was not measured; the LM figure is RSS.
- No independent security review or fuzzing statistics for Monty were found beyond the existence of a `fuzz` crate and a bounty program.
- The implementation strategy (AST walker versus bytecode VM) was not confirmed.

## Q3. CPython on WASI: tier-2 status, Wasmtime and Wasmer builds, componentize-py, py2wasm, Wasmer Python, memory and startup, Wizer pre-initialization, C extensions in Wasm

### Takeaway
Real CPython in a Wasm runtime is the strongest Group-B option for a Rust host. LM: 3.15.2 under Wasmtime 50 costs ≈7.8 MB per in-process instance and starts in 56 ms from a precompiled module, about 16–18 ms with pre-initialization (eryx, vendor). It runs pure Python about 3–4× slower than native.

The blockers are packages and I/O. The official build is WASI 0.1, with no sockets or threads, and lacks zlib, ssl, sqlite3, and ctypes. numpy works only experimentally through late-linking (eryx, componentize-py, wasi-wheels). pandas and matplotlib exist only for Wasmer's WASIX.

### Cited Findings

#### Runtime record: CPython on WASI (official build) under Wasmtime
- **(1) Identity.**
  - WASI "became a tier 2 platform starting with Python 3.13." PEP 11 now lists **`wasm32-unknown-wasip3`** as tier 2 (contacts Brett Cannon, Michael Droettboom, Savannah Ostrowski) and `wasm32-unknown-emscripten` as tier 3 (Russell Keith-Magee).
  - "WASI 0.2 support has been skipped… go straight to WASI 0.3." WASI SDK 26 and 27 were skipped because of CPython hangs — [PEP 11](https://peps.python.org/pep-0011/).
  - PEP 816 (Active, created 2025-11-05) records 3.11–3.14 on WASI 0.1. It says there is no free-threading until WASI has threads (WASI 0.3.1 "scheduled to have some form of threading support") — [PEP 816](https://peps.python.org/pep-0816/).
  - Brett Cannon's build repo published `python-3.15.2-wasi_sdk-33` (2026-10-27) and 3.16.0a2 (2026-11-10) — [releases](https://github.com/brettcannon/cpython-wasi-build/releases).
  - LM: the 3.15.2 artifact is a WASI preview1 core module (it ran through wasmtime-py's preview1 linker). `python.wasm` is 30.9 MB, about 44 MB unpacked with the stdlib.
- **(2) Group: B.** Wasm memory safety plus explicit WASI preopens; no ambient network in WASI 0.1. Wasmtime's epoch interruption is "designed to handle malicious WebAssembly guests" — [Wasmtime Config](https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html).
- **(3) Embedding.**
  - Rust: `wasmtime` crate 50.0.1 — LM (crates.io).
  - Python host: `wasmtime` 50.0.1 on PyPI — LM.
  - Node: no dedicated Python package found; jco 1.42.0 transpiles components — LM (npm).
  - Higher-level wrappers: componentize-py and eryx (below).
- **(4) Resource controls.** `consume_fuel` (off by default), `epoch_interruption`, `max_wasm_stack` (512 KiB default), and the pooling allocator — [Wasmtime Config](https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html).
- **(5) Host calls and async.** Only through Wasm imports. WASI 0.1 has no async model.
  - Async needs host-side machinery, such as eryx's callbacks below, or WASI 0.3 (the future target per PEP 11) — [PEP 11](https://peps.python.org/pep-0011/).
  - LM: `socket`, `urllib.request`, `threading`, and `subprocess` import in the 3.15.2 build, but WASI 0.1 cannot back them. `ssl`, `sqlite3`, `zlib`, `lzma`, `bz2`, and `ctypes` are absent.
- **(6) HTTP.** No embedded client works without host help. Options are a host function, `wasi:http` (component builds), or eryx's host-managed sockets.
- **(7) Footprint (LM, CPython 3.15.2 WASI, Wasmtime 50.0.1).**
  - Compile: `wasmtime compile` 629 ms, giving a 16.6 MB `.cwasm`; in-process compile 524 ms.
  - `wasmtime run … -c pass`: 136 ms and 78 MB peak RSS with the JIT cache; **55.9 ms and 27.0 MB peak RSS precompiled**; 35.2 ms with `-I -S`.
  - Importing json, re, datetime, and asyncio takes 62 ms inside the guest (versus 33 ms native).
  - In-process through wasmtime-py: instantiate plus run (`import json, re, datetime, asyncio`) **125.8 ms per instance** without pre-init, **≈7.8 MB marginal RSS per instance** (10 instances kept alive after interpreter exit).
  - Copy-on-write memory init is on by default on Linux, so pages that are only read are shared across instances of the same module — [Wasmtime Config](https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html).
- **(8) Speed (LM).** `fib(25)` 20.7 ms (≈3.1× CPython 3.14). 1e6 loop 298 ms (≈4×).
  - Older vendor pystone data (2024-04): native CPython 387,549 pystones/s versus CPython-in-Wasm 89,728 (≈23%) — [Wasmer py2wasm post](https://wasmer.io/posts/py2wasm-a-python-to-wasm-compiler).
- **(9) Snapshot and resume.**
  - Build-time pre-initialization: Wizer now lives in Wasmtime (`crates/wizer`, `wasmtime wizer` subcommand) — [Wizer README](https://raw.githubusercontent.com/bytecodealliance/wizer/main/README.md); [Zulip](https://bytecodealliance.github.io/zulip-archive/stream/217126-wasmtime/topic/Moving.20wizer.2Fcomponent-init.20into.20Wasmtime.html).
  - The standalone `wizer` crate's last version is 10.0.0 (2025-08), and its GitHub releases reach v11.0.3 (2026-03-10) — LM (registries).
  - No live mid-execution instance snapshot API was found (see Gaps).
- **(10) Ecosystem.** Pure-Python packages only, unless native wheels are late-linked (componentize-py, eryx). The design needs setjmp/longjmp, and pandas has C++ needing exceptions (2023–2024 notes, possibly stale) — [search summary of BA Zulip and hackmd notes](https://bytecodealliance.github.io/zulip-archive/stream/394175-SIG-Guest-Languages/topic/Compile.20python.20binary.20packages.20for.20componentize-py.html); [Fermyon 2023 (stale)](https://www.fermyon.com/blog/introducing-componentize-py).
- **(11) Production users.** Not verified in this research.

#### Runtime record: eryx (Rust, CPython 3.14 WASI on Wasmtime)
- **(1) Identity.** 0.15.0 (2026-11-13), MIT OR Apache-2.0, by sd2k — [docs.rs](https://docs.rs/crate/eryx/latest). Runs "full CPython 3.14," built with componentize-py — [GitHub](https://github.com/eryx-org/eryx).
- **(2) Group: B-conditional.** The Wasm boundary is sound, but the host glue is young. Two high-severity advisories were published 2026-10-27:
  - Pre-0.12.0: limits not enforced, policy-escaping hosts and files, secret exposure, and cache-poisoning.
  - Guest-controlled VFS offsets made the host allocate gigabytes outside `max_memory_bytes`.
  - Source: LM (GitHub advisories GHSA-63gm-3crm-5h8p and GHSA-8h84-8vq7-j6cv).
- **(3) Embedding.** Rust crate `eryx` (`embedded` feature adds 32 MB to the binary), PyPI `pyeryx`, npm `@bsull/eryx`. `SandboxPool` provides pre-warming, a semaphore, and idle eviction — [GitHub](https://github.com/eryx-org/eryx).
- **(4) Limits.** "memory and CPU limits," with cancellation through epoch interruption — [GitHub](https://github.com/eryx-org/eryx).
- **(5) Host calls and async.** Async Rust callbacks appear to Python as `await get_time()`, and several can run concurrently under `asyncio.gather()`. Values are serde_json — [GitHub](https://github.com/eryx-org/eryx).
- **(6) HTTP.** Off by default. `with_network()` takes an `allowed_hosts` list with wildcards. "Localhost and private networks are blocked by default, checked against the resolved address," and "The host handles DNS resolution and connection management." Plain `urllib.request.urlopen` works inside — [GitHub](https://github.com/eryx-org/eryx).
- **(7) Footprint (vendor).** Sandbox creation takes ≈18 ms with pre-init versus ≈450 ms without, and ≈16 ms precompiled versus ≈650 ms. Per-execution overhead is ≈1.6 ms, and 5 executions take ≈3 ms precompiled. `runtime.wasm` is ≈47 MB and `runtime.cwasm` ≈52 MB. No per-sandbox RSS is published — [GitHub](https://github.com/eryx-org/eryx).
- **(9) Snapshot and resume.** `snapshot_state` and `restore_state` use pickle-based serialization — [GitHub](https://github.com/eryx-org/eryx).
- **(10) Ecosystem.** `with_package()` takes `.whl` and `.tar.gz`, and "most pure-Python packages just work." numpy needs the experimental `native-extensions` feature (late-linking) — [GitHub](https://github.com/eryx-org/eryx); [eryx-runtime linker](https://docs.rs/crate/eryx-runtime/0.5.0/source/src/linker.rs).

#### componentize-py (Bytecode Alliance)
- 0.25.1 (2026-09-12), Apache-2.0. It "convert[s] a Python application to a WebAssembly component" runnable with wasmtime.
- "Currently, the application can only import dependencies during build time." The README examples use `wasi:cli/command@0.2.0`.
- Sources: [GitHub](https://github.com/bytecodealliance/componentize-py); LM (PyPI).
- **Group B** for its output (it inherits the host runtime).

#### Wasmer Python (WASIX) and the Wasmer SDK
- Wasmer 7.0 (2026-01-30) added WASIX dynamic linking, removing the "core interpreter only" limit. It also added async support for "full async support in Python," and cut Python build compiles from ~90 s to ~10 s — [Wasmer 7](https://wasmer.io/posts/wasmer-7).
- The WASIX Python index lists numpy, pandas, matplotlib, pillow, scipy, pydantic-core, lxml, cryptography, and orjson as `<version>+wasix.<N>` builds. The page heading says "220 packages" — [python-registry.wasix.org](https://python-registry.wasix.org/). A search summary reported 435 — [search result](https://python-registry.wasix.org/). The counts conflict.
- The Wasmer SDK (2026-09-01) claims "0.1ms of sandbox creation time," "2-10x faster startup," and pthreads, asyncio, and greenlets on WASIX (vendor claims, measured on an M5 Max). Hosts are Python `wasmer_sdk`, npm `@wasmer/sdk`, and Rust — [Wasmer post](https://wasmer.io/posts/wasmer-local-sandboxes-for-ai-agents). npm `@wasmer/sdk` is at 0.19.1 (2026-10-07) — LM.
- **Group B-conditional.** The Wasm boundary is sound, but WASIX deliberately exposes a broad POSIX surface (sockets, threads, fork), so authority depends on host configuration. Independent hardening evidence was not researched.

#### py2wasm
- A Nuitka-based Python-to-C-to-Wasm compiler, 2024-04-18. It claims ≈235k pystones/s versus 89.7k for CPython-in-Wasm, "about 70% of the Native Python speed." Python 3.11 only — [Wasmer](https://wasmer.io/posts/py2wasm-a-python-to-wasm-compiler).
- The repo was last pushed 2024-06-05, and PyPI's latest is 2.6.3 (2024-04-18): **stale** — LM (GitHub API, PyPI).

### Inferences
- For a Rust host, the leading candidate shape is CPython-WASI with build-time pre-init, through eryx or `wasmtime wizer` plus component-init. With copy-on-write memory images, the marginal cost should approach dirtied pages only, likely a few MB per session (inference; eryx publishes no RSS).
- HTTP should be the host-provided engine (eryx's model) rather than in-guest sockets, which also matches the "host-provided HTTP engine" benchmark arm.
- Data-science packages remain the gap for standard WASI. If pandas or matplotlib inside the Wasm sandbox is mandatory, the realistic options are Pyodide (Emscripten) or Wasmer WASIX, not Wasmtime/WASI.

### Gaps
- No published per-sandbox RSS for eryx. Its async-callback overhead per call was not measured.
- Whether CPython 3.15 builds target WASI 0.1 versus 0.3: PEP 11 lists wasip3 as tier 2, while the 3.15.2 artifact is preview1 (LM). The transition timeline is unclear.
- Official numpy or pandas WASI wheels on PyPI were not confirmed. dicej/wasi-wheels' current status is unknown.
- No live-instance (mid-execution) snapshot facility for Wasmtime was found.

## Q4. Native-embeddable Python interpreters: RustPython, MicroPython (native and Wasm), PocketPy, Starlark

### Takeaway
All of these are cheap per instance (0.7–1 MB for MicroPython-Wasm and PocketPy, about a KB for a Starlark module), but none runs normal LLM-written Python with packages.

- MicroPython-Wasm is about 8–25× slower than CPython and allows one instance per JS realm.
- PocketPy is fast but small-stdlib and C-based.
- RustPython is slow-to-start, has full ambient host access by default, and is "not totally production-ready."
- Starlark is hermetic and well-limited in Go, but it is a configuration language.

### Cited Findings

#### Runtime record: RustPython
- **(1) Identity.** "A Python Interpreter written in Rust," MIT. 0.6.0 on crates.io (2026-10-02) — LM (crates.io). It reports `3.14.0.alpha … [RustPython 0.6.0]` — LM. The README targets "CPython >= 3.15.0," has a "very experimental" JIT behind the `jit` feature, and says "RustPython is not totally production-ready" — [GitHub](https://github.com/RustPython/RustPython).
  - LM: `cargo install rustpython@0.6.0` fails to compile without `--locked` (ruff_python_ast API drift).
- **(2) Group: A as built by default.** LM: `socket`, `ssl`, `urllib.request`, `zlib`, `lzma`, `ctypes`, `threading`, and `subprocess` all import. The default features include `host_env` (which gates ctypes in rustpython-vm), `ssl-rustls-aws-lc`, and `threading` — LM (crate `Cargo.toml`).
  - It becomes B only when compiled to `wasm32-wasip1` and run in a Wasm runtime; the README shows a WASI build — [GitHub](https://github.com/RustPython/RustPython).
- **(3) Embedding.** Crates `rustpython` and `rustpython-vm`, with `examples/hello_embed.rs` — [GitHub](https://github.com/RustPython/RustPython).
- **(4) Limits.** None documented — [GitHub](https://github.com/RustPython/RustPython).
- **(7) Footprint (LM).** Release binary is 53.8 MB with the frozen stdlib. `-c pass` takes 73.9 ms (60.2 ms with `-I -S`) at ≈50 MB peak RSS. Stdlib imports take 103 ms in the guest, at 75 MB peak RSS.
- **(8) Speed (LM).** `fib(25)` 39.7 ms (≈6× CPython 3.14). Loop 217 ms (≈2.9×).
- **(11) Users.** The README lists GreptimeDB ("embedded scripting"), pyckitup, and Robot Rumble — [GitHub](https://github.com/RustPython/RustPython).

#### Runtime record: MicroPython (Wasm port, also native)
- **(1) Identity.** v1.29.0 (2026-08-24), v1.28.0 (2026-04-06), v1.27.0 (2025-12-09) — LM (GitHub releases). npm `@micropython/micropython-webassembly-pyscript` 1.29.0-6, MIT. The `.wasm` is 450 KB plus a 110 KB `.mjs` (ulab variant 642 KB) — LM. `sys.version` reports "3.4.0; MicroPython v1.29.0" — LM.
- **(2) Group: B-conditional.**
  - It is Wasm-isolated, but `registerJsModule` and the `js` FFI expose the host realm (Python can `await js.fetch(url)`), so the same realm caveat as Pyodide applies.
  - "Unfortunately interrupts have not been implemented for the browser" — [README](https://github.com/micropython/micropython/blob/master/ports/webassembly/README.md).
  - LM: creating a second `loadMicroPython()` instance in the same JS realm makes the first instance abort (`RuntimeError: Aborted(native code called abort())`), so sessions need one realm each.
  - Native MicroPython is C with a configurable module set: B-conditional at best, and less scrutinized than Lua or Luau (inference).
- **(3) Embedding.** npm, through `loadMicroPython()`, `runPython`, `runPythonAsync`, `registerJsModule`, and `pyimport`. Variants are `standard`, `pyscript`, and `browser` (JSPI). "The `browser` variant needs Node 25 or later," and other variants need Node 20 or later — [README](https://github.com/micropython/micropython/blob/master/ports/webassembly/README.md).
- **(4) Limits.** `-X heapsize` / the `heapsize` option sets the GC heap — [README](https://github.com/micropython/micropython/blob/master/ports/webassembly/README.md). No CPU limit beyond terminating the realm.
- **(5) Host calls (LM).** Sync JS call 1.07 µs; await of a JS async function 52 µs. `asyncio.gather` of 1000 100 ms host promises took 177 ms. `jsffi.run_sync()` blocks on a promise in the browser variant, and "the garbage collector does not run" while suspended — [README](https://github.com/micropython/micropython/blob/master/ports/webassembly/README.md).
- **(7) Footprint (LM).** First load 43 ms, then 7.8 ms per instance, at ≈0.78 MB marginal RSS (0.82 MB with a 16 MB `heapsize`).
- **(8) Speed (LM).** `fib(25)` 168 ms (≈25×). Loop 994 ms (≈13×).
- **(10) Ecosystem (LM).** json, re, datetime, time, asyncio, math, random, hashlib, binascii, collections, io, struct, and os import. socket, urllib, and requests do not.

#### Runtime record: PocketPy
- **(1) Identity.** "Portable Python 3.x Interpreter in Modern C," MIT, a "game scripting" alternative to Lua — [GitHub](https://github.com/pocketpy/pocketpy). v2.2.0 (2026-09-04), distributed as single-file `pocketpy.c` (1.29 MB) and `pocketpy.h` — LM (GitHub API).
- **(2) Group: B-conditional.** The OS module defaults to on (`PK_ENABLE_OS 1`), and the watchdog is a compile-time option (`PK_ENABLE_WATCHDOG 0` by default). No memory cap API was found. It is C with a small user base — LM (`pocketpy.h`).
- **(3) Embedding.** C API, plus "pybind11 compatible interfaces"; Godot, Flutter, and raylib bindings exist — [GitHub](https://github.com/pocketpy/pocketpy). Up to 16 VMs per process (`py_switchvm(index)`, 0–15), all process-global — LM (`pocketpy.h`).
- **(4) Limits.** `py_watchdog_begin(ms)` raises `TimeoutError`. LM: it fired at 200 ms on `while True: pass`.
- **(7) Footprint (LM).** 839 KB binary. Init 3.7 ms at 3.5 MB RSS. Each new VM costs 2.1 ms and **0.72 MB**.
- **(8) Speed (LM).** `fib(25)` 31.8 ms (≈4.7×). Loop 61.7 ms (≈0.8×, faster than CPython).
- **(10) Ecosystem (LM, OS disabled).** json, datetime, time, math, random, collections, base64, dataclasses, typing, and functools import. re, io, hashlib, asyncio, and itertools are absent.

#### Runtime record: Starlark (starlark-rust, starlark-go, starlark-pyo3)
- **(1) Identity.**
  - starlark-rust is "a Rust implementation of the Starlark language," a "deterministic language inspired by Python3." Buck2 "depends on this library" — [GitHub](https://github.com/facebook/starlark-rust). Crate `starlark` 0.14.2 (2026-06-05), Apache-2.0 — LM (crates.io).
  - starlark-go: pseudo-version published 2026-10-21, BSD-3-Clause — [pkg.go.dev](https://pkg.go.dev/go.starlark.net/starlark); LM (GitHub API).
  - starlark-pyo3 2026.1.3 (2026-10-19) — LM (PyPI).
- **(2) Group: B-conditional.** It is hermetic by design: the host supplies `Load`, `Print`, and builtins. Go and Rust are memory-safe. However, neither documents a per-thread memory cap, and starlark-rust documents no instruction limit, only a recursion guard (`MAX_RECURSION`, `TooManyRecursionLevel`) — [docs.rs stack_guard](https://docs.rs/crate/starlark/0.14.1/source/src/values/stack_guard.rs).
  - Buck2 applies its own 2 GB per-file memory limit as policy — [Buck2 FAQ](https://buck2.build/docs/users/faq/starlark_peak_mem/).
- **(4) Limits (starlark-go).** `SetMaxExecutionSteps` makes the interpreter call `OnMaxSteps` or `thread.Cancel("too many steps")`. "It is safe to call Cancel from any goroutine," and frozen values are "safe for publishing to other Starlark interpreters running concurrently" — [pkg.go.dev](https://pkg.go.dev/go.starlark.net/starlark).
  - A separate Python port (dbohdan/starlark-python) has opt-in `max_steps` and `max_allocs`, according to a search snippet only — [ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fdbohdan%2Fstarlark-python).
- **(5) Host calls.** Go or Rust builtins are called synchronously. No async model was found.
- **(7) Footprint.** Vendor: 1.3 ms first parse+eval, ≈0.01 ms per evaluation after — [Monty alternatives](https://pydantic.dev/docs/monty/reference/alternatives/). LM (starlark-pyo3): ≈0.07 ms to parse and eval a tiny module; memory per module was below measurement noise.
- **(8) Speed (LM).** A 1e6 loop inside a function took 211 ms (≈2.8×). Recursion was allowed under starlark-pyo3's standard globals.
- **(10) Ecosystem.** A configuration language with no general stdlib (inference from the README's scope). Monty's comparison rates its completeness "very limited" — [Monty alternatives](https://pydantic.dev/docs/monty/reference/alternatives/).

### Inferences
- MicroPython-Wasm and PocketPy are useful as a lower bound for per-session memory (≈0.7–0.8 MB) in the benchmark, not as production candidates for agent work: no pandas, slow or partial stdlib, and weak isolation evidence.
- Starlark suits hermetic, deterministic "plans" (it is used for build configs). It will fail on most LLM-written Python (no classes or exceptions, function-only loops in some dialects).
- RustPython offers no advantage over CPython-on-WASI for sandboxing. It is slower, has ambient host access by default, and is less compatible.

### Gaps
- No published RustPython benchmark numbers for 0.6.0 were found.
- Whether starlark-rust's `Evaluator` exposes a configurable step or heap limit was not found.
- MicroPython native embedding into Rust or Node (non-Wasm), and its fuzzing status, were not researched.
- No security record (CVEs or fuzzing) was found for PocketPy or MicroPython-Wasm.

## Q5. Restricted execution inside CPython: smolagents LocalPythonExecutor, RestrictedPython, asteval/simpleeval, PyPy sandbox, CPython subinterpreters. Which are security boundaries?

### Takeaway
None of them is a security boundary, so all belong in Group A. Each in-CPython restriction layer has had repeated, recent escapes (2025–2026 CVEs). The PyPy sandbox is unmaintained. CPython's own docs say subinterpreters must not be used in security-sensitive situations; LM confirms `os` access works inside one.

### Cited Findings
- **smolagents LocalPythonExecutor (1.26.0, 2026-05-29; LM PyPI).**
  - It walks the AST "operation by operation." Imports are disallowed unless allowlisted, there is an operation cap (for example 1,000,000 while-loop iterations), and undefined operations raise.
  - The docs warn that "no local python sandbox can ever be completely secure… The only way to run LLM-generated code with truly robust security isolation is to use remote execution options like E2B or Docker" — [smolagents docs](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution).
  - CVE-2025-5120: a sandbox escape to RCE, fixed in 1.17.0, with CVSS listed as 10.0 by NVD and 7.6 by huntr. `evaluate_name` returned unwrapped `getattr` — [GitLab advisory](https://advisories.gitlab.com/pkg/pypi/smolagents/CVE-2025-5120/).
  - **Group A.**
- **RestrictedPython (9.0, 2026-11-04).** Published GitHub advisories:
  - CVE-2023-37271 (stack-frame escape)
  - CVE-2023-41039 (format escape)
  - CVE-2024-47532 (info leak)
  - CVE-2025-22153 (try/except* type confusion)
  - CVE-2026-55830 (guard hooks shadowed through positional-only args, 2026-06-22)
  - CVE-2026-76825 (`string.Formatter` escape, 2026-07-20)
  - Sources: LM (GitHub advisories API); [corgea](https://corgea.com/advisories/vulnerabilities/CVE-2026-76825).
  - **Group A.**
- **asteval (1.0.10) and simpleeval (1.0.8).**
  - asteval CVE-2025-24359 (format-string escape) — [OSV](https://osv.dev/vulnerability/CVE-2025-24359).
  - asteval CVE-2026-55244 (raising `BaseException` subclasses; fixed in 1.0.9) — [GitLab](https://advisories.gitlab.com/pypi/asteval/CVE-2026-55244/).
  - "Multiple sandbox escapes in asteval" (2025-03) — [Full Disclosure](https://seclists.org/fulldisclosure/2025/Mar/0).
  - simpleeval CVE-2026-32640 (dangerous objects leaking through names; fixed in 1.0.5, 2026-03-13) — [Wiz](https://www.wiz.io/vulnerability-database/cve/cve-2026-32640).
  - **Group A.**
- **PyPy sandbox.** "This describes the old, unmaintained version." It was tested with PyPy2. The design is a subprocess that marshals each external call to a trusted controller. A successor in the `sandbox-2` branches dates to a 2019 mailing-list post (**possibly stale**) — [PyPy docs](https://doc.pypy.org/en/latest/sandbox.html).
  - **Group A** (unmaintained). The syscall-proxy idea is sound but needs process isolation anyway.
- **CPython subinterpreters (PEP 734, `concurrent.interpreters`, added in 3.14).** "Interpreters in the same process can technically never be strictly isolated… do not use multiple interpreters in security-sensitive situations" — [Python docs](https://docs.python.org/3/library/concurrent.interpreters.html).
  - LM (3.14.10): about 16.5 ms to create one and import json, re, and datetime; **≈3.6 MB marginal RSS each**; `os.listdir('/')` works inside.
  - **Group A**, but useful as a cheap concurrency primitive inside an already-isolated process.

### Inferences
- These tools belong in a benchmark only as "no-isolation" baselines. They have near-zero overhead because they run in the host CPython, but they always need Group-A process isolation for untrusted code.
- The CVE history (RestrictedPython: six advisories through 2026-07; asteval and simpleeval: several 2025–2026; smolagents: CVSS 10 per NVD) is strong evidence against relying on AST-level or compile-time restriction.

### Gaps
- The exact CVSS for some 2026 CVEs varies across aggregators. CVE-2026-102734 (asteval) appears only in Wiz with no detail.
- No primary GHSA for smolagents CVE-2025-5120 was fetched; the details come from GitLab and aggregators.

## Q6. Group A native Python: CPython 3.13, 3.14, and 3.15 (including free-threaded) and PyPy idle RSS and startup; import cost of pandas, numpy, and matplotlib; fork-server and zygote approaches; GraalPy

### Takeaway
Native CPython is the compatibility and speed baseline, at about 12 MB idle and 20–29 ms to start, and ≈105 MB and ≈0.47 s with numpy, pandas, and matplotlib.

A preloaded zygote changes the memory picture. LM: 20 children forked from a CPython 3.14 parent holding numpy, pandas, and matplotlib each cost only **3.45 MB USS and 7.2 MB PSS**. That is roughly an order of magnitude below Pyodide or WASI per-session costs, but it requires OS sandboxing per child. PyPy (58 MB idle) and free-threaded builds (+3 MB idle, about 20% slower imports) add cost without helping sandboxing. GraalPy's sandbox policies are documented only for JavaScript.

### Cited Findings
- **Versions.**
  - Python 3.15.0 was "released on 9 October 2026." PEP 810 explicit lazy imports add the `lazy` keyword, plus `-X lazy_imports=all` / `PYTHON_LAZY_IMPORTS`, for faster startup.
  - 3.14.0–3.14.4 shipped an incremental GC that "has been reverted back to the generational GC from 3.13" after "significant memory pressure" reports (3.14.5+, and 3.15).
  - PEP 803 adds an `abi3t` stable ABI for free-threaded builds.
  - Source: [What's New 3.15](https://docs.python.org/3.15/whatsnew/3.15.html).
  - LM: uv provides 3.15.2 and 3.14.10 as the current builds.
- **CPython startup and idle memory (LM; median of 20 starts; RSS / USS).**

  | Build | `-c pass` | `-I -S -c pass` | Idle RSS | Idle USS |
  |---|---|---|---|---|
  | 3.13.5 | 27.8 ms | 21.5 ms | 13.2 MB | 10.8 MB |
  | 3.14.10 | 29.2 ms | 21.9 ms | 12.1 MB | 9.8 MB |
  | 3.14.10t (free-threaded) | 30.6 ms | 24.3 ms | 15.3 MB | 13.0 MB |
  | 3.15.2 | 26.7 ms | 20.2 ms | 12.8 MB | 10.5 MB |

- **Import cost on CPython 3.14.10 (LM; median of 5, warm `.pyc`; import time and RSS delta).**
  - json, re, datetime, and asyncio: 33 ms, +6.5 MB
  - `urllib.request`: 22 ms, +5.3 MB
  - requests: 75 ms, +16.5 MB
  - httpx: 51 ms, +10.8 MB
  - numpy 2.5.4: 63 ms, +17.7 MB
  - pandas: 242 ms, +60.8 MB
  - matplotlib.pyplot 3.11.2: 351 ms, +56.5 MB
  - `PIL.Image`: 13 ms, +4.2 MB
  - **numpy, pandas, and matplotlib.pyplot together: 471 ms, +92 MB (104.6 MB total RSS)**
  - 3.15.2 is within ±10% of these figures. 3.14t: pandas 293 ms (+71 MB); all three 561 ms (+109 MB).
- **PyPy (LM, PyPy 8.0.1, Python 3.11.17).** Startup 56.6 ms (42.1 ms with `-I -S`); idle RSS 57.8 MB. numpy imports in 146 ms (+23 MB) and pandas in 570 ms (+80 MB); matplotlib and Pillow wheels did not install.
  - PyPy 8.0.0 (2026-09-19) and 8.0.1 (2026-10-14) include 2.7, 3.11, and a 3.12 beta — [PyPy release notes](https://doc.pypy.org/index-of-release-notes.html). 8.0 drops HPy — [AlternativeTo](https://alternativeto.net/news/2026/9/pypy-8-0-brings-python-3-12-beta-support-better-rpython-code-generation-and-drops-hpy/).
  - LM speed: the 1e6 loop took 1.35 ms (JIT, ≈55× faster than CPython). `fib(25)` took 11.6 ms on first run (warmup).
- **Speed tier (LM; `fib(25)` / 1e6 loop).** 3.13.5: 12.4 / 67.3 ms. 3.14.10: 6.7 / 74.5 ms. 3.14t: 9.9 / 78.3 ms. 3.15.2: 11.3 / 96.0 ms. These are single runs and noisy.
  - Secondary sources claim the 3.15 JIT gives 4–13% gains (unverified) — [linuxcompatible](https://www.linuxcompatible.org/story/python-3150-is-out-lazy-imports-frozendict-and-faster-speeds/).
- **Fork-server and zygote (LM, CPython 3.14.10).** The parent imported numpy, pandas, and matplotlib.pyplot, then ran `gc.collect(); gc.freeze()`, reaching 104.8 MB RSS. It then forked 20 children, each building a 1000-row DataFrame.
  - Per child: median RSS 82.6 MB, **PSS 7.2 MB, USS 3.45 MB**.
  - Compare 104.6 MB RSS for a fresh process with the same imports.
- **Snapshot-based warm starts (vendor claims).**
  - AWS Lambda SnapStart for Python (supported since 2024-11) targets "sub-second startup" — [AWS docs](https://docs.aws.amazon.com/en_gb/lambda/latest/dg/snapstart.html).
  - Modal memory snapshots: "typically start 1.5–3x faster" (beta docs, via search) — [Modal](https://modal.com/docs/guide/memory-snapshots.md).
  - Cloudflare's own comparison showed Lambda without SnapStart at 2.502 s — [Cloudflare](https://blog.cloudflare.com/python-workers-advancements).
- **GraalPy.**
  - The 25.x line supports Python 3.12.8. JVM Standalone artifacts were dropped from 25.0.3 — [GraalPy docs via search](https://www.graalvm.org/python/python-developers/docs). The latest GitHub release is graal-25.5.5 (2026-11-03) — LM (GitHub API).
  - GraalVM's sandbox policies TRUSTED, CONSTRAINED, ISOLATED, and UNTRUSTED bring CPU time, heap, stack-frame, AST-depth, thread, and output limits. ISOLATED and UNTRUSTED need "isolated images of the languages," and the page explicitly names only JavaScript ("currently only supported for… ECMAScript 2022"). GraalPy policy support is not stated — [GraalVM sandboxing](https://www.graalvm.org/latest/security-guide/sandboxing/).
  - GraalPy defaults to a Java POSIX backend when embedded — [search summary of GraalPy docs](https://www.graalvm.org/jdk24/reference-manual/python/Embedding-Permissions/).
  - **Group A** for agentOS purposes: the host is Java, and the untrusted-code policy is not documented for Python.

### Inferences
- If Group-A isolation is acceptable (Landlock, seccomp, and namespaces per child, or gVisor), a native CPython zygote is the most memory-efficient way to give agents real pandas or matplotlib. It is ≈3.5 MB unique per session versus ≈42–78 MB for Pyodide and ≈130–180 MB more once pandas loads. It is also ≈5–9× faster at import and ≈3× faster at compute.
  - The catch is that fork-based sharing erodes as children write to inherited objects (refcount writes dirty pages), so measure under realistic workloads (inference).
- Free-threaded builds and PyPy are not worth separate benchmark arms for sandboxing. Free-threading adds ≈3 MB idle and ≈20% import time. PyPy adds ≈46 MB idle, and its JIT warmup does not pay off for short agent scripts (inference from LM).
- Lazy imports (3.15) could cut cold-start cost for agent preambles that import much but use little (inference; unmeasured).

### Gaps
- GraalPy startup and RSS were not measured, and whether GraalPy supports CONSTRAINED/ISOLATED is undocumented.
- Free-threaded zygote behavior, and PSS growth after heavier child work, were not measured.
- Official 3.15 JIT benchmark numbers were not found (the What's New text was truncated).

## Q7. Which Python variant best balances compatibility (LLMs write normal Python with the stdlib and pandas) against footprint?

### Takeaway
No single variant wins, so benchmark three tiers.

- **Monty** for pure code mode: lowest cost, but a language subset.
- **Real CPython inside Wasm** for compatibility with an in-process boundary: Pyodide on a Node host, or CPython-WASI/eryx on a Rust host.
- **A native CPython zygote under OS isolation** as the compatibility and footprint ceiling.

On current evidence, CPython-WASI with pre-init on Wasmtime best balances compatibility and footprint for stdlib-only agent work. Pyodide is the only in-process option with pandas and matplotlib today, but it requires a capability-free JS realm plus ctypes removal to be safe.

### Cited Findings
- Compatibility ladder:
  - Monty: a deliberate subset, no packages — [limitations](https://pydantic.dev/docs/monty/limitations/)
  - CPython-WASI: full stdlib minus C-library modules (zlib, ssl, sqlite3, ctypes absent in the 3.15.2 build), pure-Python wheels, experimental numpy — LM; [eryx](https://github.com/eryx-org/eryx)
  - Pyodide: 357 packages including pandas 3.0.2, matplotlib, pyarrow, polars, and duckdb — LM (lockfile)
  - Native CPython: everything.
- Footprint ladder (marginal per session):
  - PocketPy or MicroPython-Wasm: ≈0.7–0.8 MB — LM
  - Native CPython zygote child: ≈3.5 MB USS, even with pandas preloaded — LM
  - CPython-WASI in-process: ≈7.8 MB without pre-init — LM
  - Monty native worker: ≈9.5 MB RSS — LM (vendor: ≈2 MB)
  - Pyodide: ≈42 MB in a shared isolate, ≈71–78 MB per worker isolate, ≈48–51 MB from a snapshot — LM
- Start latency ladder:
  - Monty: 0.2 ms per feed — LM
  - CPython-WASI: ≈16–18 ms with pre-init — [eryx](https://github.com/eryx-org/eryx); 56 ms precompiled CLI — LM
  - Native fork from a zygote: not measured
  - Native fresh: 20–29 ms — LM
  - Pyodide from a snapshot: 146–183 ms — LM
  - Pyodide fresh: 1.3–1.85 s — LM
- Host-call ladder:
  - Pyodide sync call: 0.8 µs — LM
  - MicroPython-Wasm sync call: 1.1 µs — LM
  - Pyodide or MicroPython async await: 39–63 µs — LM
  - Monty native worker: 63 µs per call — LM
  - Monty Wasm: 130–140 µs — LM
- Security ladder:
  - Restricted CPython (A) — [smolagents](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution); [RestrictedPython advisories](https://github.com/zopefoundation/RestrictedPython/security/advisories)
  - Pyodide in Node (A-risk) — LM; [Cyera](https://www.cyera.com/research/sandcastles-not-sandboxes-how-one-architectural-flaw-exposed-seven-products)
  - Monty in-process (B-conditional) — [Monty security](https://pydantic.dev/docs/monty/concepts/security/)
  - Wasmtime/WASI (B) — [Wasmtime](https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html)

### Inferences
- **Recommended Python benchmark arms:**
  1. **Monty**: Rust `monty` crate in-process, plus npm `@pydantic/monty` subprocess and Wasm modes. This is the code-mode efficiency leader. Measure host-call cost in-process and the compatibility hit rate on real agent scripts.
  2. **Pyodide 314.x on Node 26** (JSPI default):
     - shared-isolate and isolate-per-session variants
     - fresh versus memory-snapshot restore
     - with ctypes and Emscripten exports stripped, and run inside a realm without Node APIs (agentOS's V8 isolates), to test whether a safe configuration costs extra
  3. **CPython 3.14/3.15 on Wasmtime with pre-init** (eryx, or `wasmtime wizer` plus component-init) for the Rust host. Include host-provided HTTP (eryx's allowlisted host networking) versus host-function fetch.
  4. **Native CPython 3.14 zygote** (forkserver, `gc.freeze`) under Landlock/seccomp or gVisor as the Group-A reference, with and without pandas preloaded.
  5. A **minimal-footprint control**: MicroPython-Wasm (one realm per session) or PocketPy, to show the floor.
  6. Optional: **starlark-go or starlark-rust**, as the hermetic "plan language" reference.
- **Skip as benchmark arms:**
  - RestrictedPython, asteval, simpleeval, and smolagents' local executor: no isolation, and repeated escapes.
  - RustPython: Group A by default, slow, and "not totally production-ready."
  - py2wasm: stale.
  - PyPy and GraalPy: high idle memory or no documented Python sandbox.
  - Brython and Skulpt: low compatibility and unproven server use.
- For agentOS specifically, the cheapest high-value action is a security fix, not a benchmark: confirm that Pyodide guests cannot import `ctypes`/`_ctypes` or reach `emscripten_run_script*` and `system`. The prior note's `js`/`pyodide_js` block alone is insufficient, as reproduced in LM.

### Gaps
- No head-to-head data exists for "1000 slow host calls" on CPython-WASI/eryx or on in-process Monty; these are the key unmeasured cells.
- No measured numbers exist for pandas inside Wasmer WASIX, or for Python startup on the Wasmer SDK (vendor charts only).
- The compatibility of LLM-generated scripts against the Monty subset has not been quantified anywhere found.
