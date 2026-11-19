"""Measure native Python startup, idle memory, import cost, speed, and fork sharing.

Usage: python3 -I native_bench.py <scratch dir>
Reports medians. Memory is read from /proc (VmRSS, and Pss/Private from smaps_rollup).
"""

import json
import os
import statistics
import subprocess
import sys
import time

SCRATCH = sys.argv[1]

# Resolve uv-managed interpreters and venvs.
def uv_find(spec):
	return subprocess.run(["uv", "python", "find", spec], capture_output=True, text=True).stdout.strip()

INTERPRETERS = {
	"cpython-3.13.5": uv_find("3.13"),
	"cpython-3.14.10": f"{SCRATCH}/venv314/bin/python",
	"cpython-3.14.10t (free-threaded)": f"{SCRATCH}/venv314t/bin/python",
	"cpython-3.15.2": f"{SCRATCH}/venv315/bin/python",
	"pypy-3.11.17 (7.3.x)": f"{SCRATCH}/venvpypy/bin/python",
}

MEM_SNIPPET = r"""
def _mem():
    d = {}
    for line in open('/proc/self/status'):
        if line.startswith(('VmRSS', 'VmHWM')):
            k, v = line.split(':')
            d[k] = int(v.split()[0]) / 1024
    for line in open('/proc/self/smaps_rollup'):
        if line.startswith(('Pss:', 'Private_Clean', 'Private_Dirty')):
            k, v = line.split(':')
            d[k] = int(v.split()[0]) / 1024
    d['USS'] = d.get('Private_Clean', 0) + d.get('Private_Dirty', 0)
    return d
"""


def timed_runs(argv, n, env=None):
	samples = []
	for i in range(n + 2):
		t = time.perf_counter()
		subprocess.run(argv, capture_output=True, env=env)
		dt = (time.perf_counter() - t) * 1000
		if i >= 2:
			samples.append(dt)
	return round(statistics.median(samples), 1)


def run_json(py, code, env=None):
	res = subprocess.run([py, "-c", MEM_SNIPPET + code], capture_output=True, text=True, env=env)
	if res.returncode != 0:
		return {"error": res.stderr.strip().splitlines()[-1][:200] if res.stderr else "failed"}
	return json.loads(res.stdout.strip().splitlines()[-1])


def median_dicts(dicts):
	keys = dicts[0].keys()
	return {k: round(statistics.median(d[k] for d in dicts), 1) for k in keys}


results = {}
env_agg = dict(os.environ, MPLBACKEND="Agg")

for name, py in INTERPRETERS.items():
	r = {}
	r["startup_ms_site"] = timed_runs([py, "-c", "pass"], 20)
	r["startup_ms_isolated_nosite"] = timed_runs([py, "-I", "-S", "-c", "pass"], 20)
	r["idle_mem_mb"] = median_dicts([run_json(py, "import json; print(json.dumps(_mem()))") for _ in range(5)])

	speed = run_json(
		py,
		"""
import json, time
def fib(n):
    return n if n < 2 else fib(n-1) + fib(n-2)
t = time.perf_counter(); fib(25); a = (time.perf_counter() - t) * 1000
t = time.perf_counter()
s = 0
for i in range(1000000):
    s += i * i
b = (time.perf_counter() - t) * 1000
print(json.dumps({'fib25_ms': a, 'loop1e6_ms': b}))
""",
	)
	r["speed"] = speed

	imports = {}
	for label, stmt in [
		("stdlib json+re+datetime+asyncio", "import json, re, datetime, asyncio"),
		("urllib.request", "import urllib.request"),
		("requests", "import requests"),
		("httpx", "import httpx"),
		("numpy", "import numpy"),
		("pandas", "import pandas"),
		("matplotlib.pyplot", "import matplotlib.pyplot"),
		("PIL.Image", "import PIL.Image"),
		("numpy+pandas+matplotlib.pyplot", "import numpy, pandas, matplotlib.pyplot"),
	]:
		code = (
			"import json as _j, time as _t\n"
			"_a = _mem()\n"
			"_s = _t.perf_counter()\n"
			f"{stmt}\n"
			"_d = (_t.perf_counter() - _s) * 1000\n"
			"_b = _mem()\n"
			"print(_j.dumps({'import_ms': _d, 'rss_after_mb': _b['VmRSS'], 'rss_delta_mb': _b['VmRSS'] - _a['VmRSS'], 'uss_after_mb': _b['USS']}))\n"
		)
		first = run_json(py, code, env=env_agg)  # warm .pyc caches
		if "error" in first:
			imports[label] = first
			continue
		imports[label] = median_dicts([run_json(py, code, env=env_agg) for _ in range(5)])
	r["imports"] = imports
	results[name] = r

# Fork-server style sharing on CPython 3.14: preload heavy modules, freeze GC, fork children.
fork_code = r"""
import os, sys, time, json, gc
import numpy, pandas, matplotlib.pyplot
gc.collect(); gc.freeze()
parent = _mem()
N = 20
pids = []
r, w = os.pipe()
for i in range(N):
    pid = os.fork()
    if pid == 0:
        df = pandas.DataFrame({'a': range(1000), 'b': range(1000)})
        s = int(df.a.sum() + df.b.mean())
        os.write(w, b'x')
        time.sleep(3)
        os._exit(0)
    pids.append(pid)
for _ in range(N):
    os.read(r, 1)
child = []
for pid in pids:
    d = {}
    for line in open(f'/proc/{pid}/smaps_rollup'):
        if line.startswith(('Rss:', 'Pss:', 'Private_Clean', 'Private_Dirty')):
            k, v = line.split(':')
            d[k] = int(v.split()[0]) / 1024
    d['USS'] = d['Private_Clean'] + d['Private_Dirty']
    child.append(d)
for pid in pids:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
import statistics
print(json.dumps({
  'parent_rss_mb': parent['VmRSS'],
  'children': N,
  'child_rss_median_mb': statistics.median(c['Rss'] for c in child),
  'child_pss_median_mb': statistics.median(c['Pss'] for c in child),
  'child_uss_median_mb': statistics.median(c['USS'] for c in child),
}))
"""
results["fork_sharing_cpython_3.14"] = run_json(INTERPRETERS["cpython-3.14.10"], fork_code, env=env_agg)

print(json.dumps(results, indent=1))
