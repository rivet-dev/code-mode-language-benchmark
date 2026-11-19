"""Measure CPython 3.15.2 (wasm32-wasip1 build) under Wasmtime 50.0.1.

Usage: <venv python with wasmtime==50.0.1> -I wasi_bench.py <python dir> <wasmtime cli>
CLI runs report wall time and peak child RSS. The in-process section embeds Wasmtime
through wasmtime-py (Wasmtime's C API) and reports marginal RSS per extra instance.
"""

import json
import os
import resource
import statistics
import subprocess
import sys
import time

PYDIR = sys.argv[1]
WASMTIME = sys.argv[2]
WASM = f"{PYDIR}/python.wasm"
CWASM = f"{PYDIR}/../wasi-python.cwasm"
out = {}


def cli(args, n=7):
	"""Runs a CLI command n times in a fresh helper process and returns median ms and peak RSS."""
	samples = []
	rss = []
	for _ in range(n):
		code = (
			"import resource, subprocess, sys, time, json\n"
			"t = time.perf_counter()\n"
			"r = subprocess.run(json.loads(sys.argv[1]), capture_output=True, text=True)\n"
			"dt = (time.perf_counter() - t) * 1000\n"
			"print(json.dumps({'ms': dt, 'maxrss_mb': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024, 'out': r.stdout[-300:], 'err': r.stderr[-300:]}))\n"
		)
		res = subprocess.run([sys.executable, "-I", "-c", code, json.dumps(args)], capture_output=True, text=True)
		d = json.loads(res.stdout)
		samples.append(d["ms"])
		rss.append(d["maxrss_mb"])
		last = d
	return {"median_ms": round(statistics.median(samples), 1), "peak_rss_mb": round(statistics.median(rss), 1), "stdout": last["out"].strip()[:200], "stderr": last["err"].strip()[-200:]}


base = [WASMTIME, "run", "--dir", f"{PYDIR}::/"]
t = time.perf_counter()
subprocess.run([WASMTIME, "compile", WASM, "-o", CWASM], check=True)
out["cli_compile_ms"] = round((time.perf_counter() - t) * 1000)
out["cwasm_mb"] = round(os.path.getsize(CWASM) / 1048576, 1)
out["wasm_mb"] = round(os.path.getsize(WASM) / 1048576, 1)
out["cli_run_pass_jit_cached"] = cli(base + [WASM, "-c", "pass"])
pre = [WASMTIME, "run", "--allow-precompiled", "--dir", f"{PYDIR}::/"]
out["cli_run_pass_precompiled"] = cli(pre + [CWASM, "-c", "pass"])
out["cli_run_pass_precompiled_nosite"] = cli(pre + [CWASM, "-I", "-S", "-c", "pass"])
out["cli_import_stdlib"] = cli(
	pre
	+ [
		CWASM,
		"-c",
		"import time; t=time.perf_counter(); import json, re, datetime, asyncio; print((time.perf_counter()-t)*1000)",
	],
	n=5,
)
out["cli_speed"] = cli(
	pre
	+ [
		CWASM,
		"-c",
		"import time\ndef fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\nt=time.perf_counter(); fib(25); a=(time.perf_counter()-t)*1000\nt=time.perf_counter()\ns=0\nfor i in range(1000000):\n    s += i*i\nb=(time.perf_counter()-t)*1000\nprint(round(a,1), round(b,1))",
	],
	n=3,
)
out["cli_modules"] = cli(
	pre
	+ [
		CWASM,
		"-c",
		"ok=[]\nfor m in ['socket','ssl','urllib.request','http.client','sqlite3','zlib','lzma','bz2','ctypes','threading','subprocess','asyncio','hashlib','decimal','zoneinfo','_json']:\n    try:\n        __import__(m); ok.append(m)\n    except Exception as e:\n        ok.append('!'+m)\nprint(' '.join(ok))",
	],
	n=1,
)

# In-process embedding: compile once, then instantiate many stores.
import wasmtime


def rss_mb():
	for line in open("/proc/self/status"):
		if line.startswith("VmRSS"):
			return int(line.split()[1]) / 1024


cfg = wasmtime.Config()
engine = wasmtime.Engine(cfg)
t = time.perf_counter()
module = wasmtime.Module.from_file(engine, WASM)
out["inproc_compile_ms"] = round((time.perf_counter() - t) * 1000)
linker = wasmtime.Linker(engine)
linker.define_wasi()


def run_instance(argv):
	store = wasmtime.Store(engine)
	wasi = wasmtime.WasiConfig()
	wasi.argv = argv
	wasi.preopen_dir(PYDIR, "/")
	store.set_wasi(wasi)
	inst = linker.instantiate(store, module)
	try:
		inst.exports(store)["_start"](store)
	except wasmtime.ExitTrap:
		pass
	return store, inst


run_instance(["python", "-c", "pass"])
r0 = rss_mb()
keep = []
t = time.perf_counter()
for _ in range(10):
	keep.append(run_instance(["python", "-c", "import json, re, datetime, asyncio"]))
out["inproc_avg_instantiate_and_run_ms"] = round((time.perf_counter() - t) * 1000 / 10, 1)
out["inproc_marginal_rss_per_instance_mb"] = round((rss_mb() - r0) / 10, 1)
print(json.dumps(out, indent=1))
