# Code mode language benchmark

In code mode, a model answers a request by writing a short script that calls the host's tools, instead of calling the tools one at a time itself. Every script runs in a fresh, isolated interpreter, so the interpreter's cost per invocation decides how many scripts one host can keep alive, how much latency each one adds before it does anything useful, and how expensive each tool call is. This repository measures those costs for the scripting runtimes a host is likely to embed or spawn.

A runtime is either embedded in the host process (a Lua state, a V8 isolate, an interpreter compiled to WebAssembly, an engine hosted in Rust) or run as a separate process (Node, Deno, Bun, CPython, bash, dash). Both kinds are measured with the same definitions, so they can sit in one table.

## What is measured

**Base memory per invocation** is the memory one more instance adds above the baseline, measured while it sits idle after answering `1 + 1`. For embedded runtimes it is the host's resident memory growth divided by the number of live instances. For processes it is the growth of the cgroup's `memory.current` per added process, with the measuring script running inside `systemd-run --user --scope -p MemoryAccounting=yes`, so it includes the kernel's memory for each process, such as page tables and kernel stacks.

**Time to first response** runs from creating a fresh instance until the host reads its answer to `1 + 1`. An embedded runtime creates its isolate, state or module and then evaluates. A process is timed from spawn until the host reads its first line of output. Node, Deno and Bun each print with their own console I/O, because Bun's Node-compatible stdout costs it about 15 ms at startup. The median is reported.

**Tool call round trip** is measured in an instance that is already running. Script code sends one JSON tool call, `{id, tool, args}`, and waits for the reply, and the host answers at once. Processes exchange JSON lines over stdio, reading lines natively in Deno and Bun, and the host times every call to report the true per-call median. Embedded calls take from well under a microsecond to tens of microseconds, so the embedded harnesses time batches of 100 to 10,000 calls and report the median batch's mean time per call.

**Compute** parses and aggregates 3 MB of JSON: 20,000 orders from a deterministic generator, grouped by region and customer. Every runtime uses a native JSON parser. Lua and LuaJIT use lua-cjson 2.1.0.20, built from its release source rather than installed. Each runtime runs the task nine times in one process, discards two warm-up runs and reports the median of the other seven, and every run's result must match a reference checksum.

**Instances per GiB** is 1 GiB divided by base memory.

## Results

<!-- results:start -->
Results have not been generated yet. Run `npm run bench`.
<!-- results:end -->

## Running it

You need a Linux host with cgroup v2 and a systemd user session, so that `systemd-run --user --scope` works, and these tools on `PATH`:

- Node 22 and npm
- Deno and Bun
- `python3` (CPython 3)
- `lua` (5.5) and `luajit`, with their headers and static libraries under one prefix (`include/lua`, `include/luajit-2.1`, `lib/liblua.a` and `lib/libluajit.a`, as Homebrew installs them)
- `gcc`, `curl` and `tar`
- `bash` and `dash`
- `cargo` (stable Rust)
- `chromium`, to render the charts

Then install the JavaScript dependencies and run everything:

```sh
npm install
npm run bench
```

`npm run bench` runs every language one after another in a single sitting, writes one file per runtime to `results/`, then rewrites the results section of this README and regenerates `charts/`. A full run takes about four minutes once the Rust engines are built; their first build takes much longer. The Lua runner downloads lua-cjson from GitHub on its first run and checks its SHA-256 hash.

To run some languages only, name them: `npm run bench -- lua python`. The languages are `lua`, `javascript`, `python`, `shell` and `rust-hosted`. To rebuild only the README or only the charts from the results already on disk, run `npm run readme` or `npm run charts`.

Three environment variables change where tools are found. `LUA_PREFIX` points at the prefix that holds the Lua and LuaJIT headers and static libraries; it defaults to the prefix of the `lua` binary. `CARGO_TARGET_DIR` reuses an existing Rust build, with each engine built into its own subdirectory. `CHROMIUM` names the browser binary.

## Layout

```
benches/
  common/       shared process suite, cgroup memory, compute runner and dataset, results writer
  lua/          Lua and LuaJIT embedded in a C host and run as processes
  javascript/   V8 (isolated-vm) and QuickJS (Wasm) embedded in Node; Node, Deno and Bun processes
  python/       Pyodide and MicroPython embedded in Node; CPython spawned and forked
  shell/        bash and dash processes
  rust-hosted/  Luau, rquickjs, Rhai, Rune, Koto, Roto, Steel, Starlark, Boa and Monty in Rust
  fluency/      the language fluency eval, kept as it ran and not part of npm run bench
results/        one normalized file per runtime; raw/ keeps each harness's own output
charts/         the generated PNGs; src/ holds the chart pages and icons/ the logos
scripts/        run_all.mjs, update_readme.mjs and render_charts.mjs
docs/           the research report and notes behind the benchmark
```

Each language folder has a `run.mjs` that builds what it needs, runs its harnesses and writes `results/<runtime>.json`. Every results file has the same fields: `runtime`, `label`, `language`, `group` (`embedded` or `process`), `host`, `version`, `metrics`, `notes`, `measuredAt` and `loadAverage`. `metrics` holds `memoryBytes`, `startMs`, `toolCallUs`, `computeMs` and `instancesPerGiB`, each null when it does not apply. `notes` explains how each number was taken and adds secondary numbers, and `loadAverage` gives the 1, 5 and 15 minute load averages when the runtime's measurements started and ended.

## Caveats

The hosts differ. Embedded Lua and LuaJIT run in a small C host, the Rust-hosted engines run in Rust, and the other embedded runtimes run in Node, so every embedded number includes its own host's binding costs.

V8's tool call goes through isolated-vm. The reported number uses a same-thread binding built from isolated-vm's synchronous calls, which resolves the guest's promise the way deno_core ops do. isolated-vm's own async API is several times slower; `results/v8.json` has both.

Processes are launched and served from Node, so process start times and tool calls include the cost of Node's child process and stream handling on the host side.

The numbers come from a shared host with other work running, and nothing on it was paused. The load average is recorded for every runtime, and absolute numbers move from run to run, so compare rows from the same run.

Lua and LuaJIT time the compute task with `os.clock()`, which counts process CPU time, because standard Lua has no finer clock. Their compute samples spread the most of any runtime on a busy host, so check the samples in `results/raw/lua/compute.json` before reading much into them.

Pyodide and MicroPython instances share one JavaScript realm, so they act as separate sandboxes only with their JavaScript bridges locked down, and MicroPython's bridge can serve host calls only for the newest instance in a realm.

The fluency eval in `benches/fluency` asked one model to solve the same ten tool-calling tasks in Python, JavaScript, Lua and bash. Every language scored 10 of 10, so the eval could not rank them and is not rerun.

## Further reading

`docs/report.md` is the research report this benchmark grew out of; `docs/index.html` renders it with its charts. `docs/notes/` holds the supporting notes, earlier probe scripts and the sanity checks behind the methods above.
