"""Measure hello-world startup latency, peak RSS, and idle memory breakdown of native runtimes.

Idle memory is read from /proc/<pid>/smaps_rollup and /proc/<pid>/status after the
runtime has settled while blocked on stdin (or a timer), so we can separate private
anonymous memory (true marginal cost per extra process) from file-backed pages that
are shareable across processes running the same binary.
"""
import json
import os
import statistics
import subprocess
import sys
import time

N = int(os.environ.get("N", "21"))
WARM = 3
SETTLE = float(os.environ.get("SETTLE", "2.0"))
B = sys.argv[1]
OUT = sys.argv[2]

# Tool locations on the measuring host; set these environment variables to point at each build.
HB = os.environ.get("HB", os.path.join(os.environ.get("HOMEBREW_PREFIX", "/usr/local"), "bin"))
NODE22 = os.environ.get("NODE22", "node")
NODE24 = os.environ.get("NODE24", "node")
DENO = os.environ.get("DENO", "deno")
BUN = os.environ.get("BUN", "bun")
WASMER = os.environ.get("WASMER", "wasmer")

R = {
    "true (exec baseline)": (["/bin/true"], None),
    "python3.13 (Debian)": (["/usr/bin/python3.13", "-c", "print('hello')"],
                            ["/usr/bin/python3.13", "-c", "import sys; sys.stdin.read()"]),
    "python3.13 -I -S": (["/usr/bin/python3.13", "-I", "-S", "-c", "print('hello')"],
                         ["/usr/bin/python3.13", "-I", "-S", "-c", "import sys; sys.stdin.read()"]),
    "python3.14 (brew)": ([f"{HB}/python3.14", "-c", "print('hello')"],
                          [f"{HB}/python3.14", "-c", "import sys; sys.stdin.read()"]),
    "python3.15 (brew)": ([f"{HB}/python3.15", "-c", "print('hello')"],
                          [f"{HB}/python3.15", "-c", "import sys; sys.stdin.read()"]),
    "node 22.23.1": ([NODE22, "-e", "console.log('hello')"],
                     [NODE22, "-e", "setInterval(()=>{},1e6)"]),
    "node 24.18.0": ([NODE24, "-e", "console.log('hello')"],
                     [NODE24, "-e", "setInterval(()=>{},1e6)"]),
    "deno 2.5.2": ([DENO, "eval", "console.log('hello')"],
                   [DENO, "eval", "setInterval(()=>{},1e6)"]),
    "bun 1.3.14": ([BUN, "-e", "console.log('hello')"],
                   [BUN, "-e", "setInterval(()=>{},1e6)"]),
    "perl 5.44": ([f"{HB}/perl", "-e", "print qq(hello\\n)"],
                  [f"{HB}/perl", "-e", "<STDIN>"]),
    "lua 5.5.1": ([f"{HB}/lua", "-e", "print('hello')"],
                  [f"{HB}/lua", "-e", "io.read()"]),
    "luajit 2.1": ([f"{HB}/luajit", "-e", "print('hello')"],
                   [f"{HB}/luajit", "-e", "io.read()"]),
    "bash 5.2": (["/usr/bin/bash", "-c", "echo hello"], ["/usr/bin/bash", "-c", "read x"]),
    "dash": (["/usr/bin/dash", "-c", "echo hello"], ["/usr/bin/dash", "-c", "read x"]),
    "busybox sh": (["/usr/bin/busybox", "sh", "-c", "echo hello"],
                   ["/usr/bin/busybox", "sh", "-c", "read x"]),
    "go 1.27.4 binary": ([f"{B}/go-hello-bin"], [f"{B}/go-idle-bin"]),
    "wasmer 6.1.0 (WAT, cached)": ([WASMER, "run", f"{B}/hello.wat"],
                                   [WASMER, "run", f"{B}/idle.wat"]),
    "unshare -Ur (userns)": ([f"{HB}/unshare", "-U", "-r", "/bin/true"], None),
    "unshare -Urn (userns+netns)": ([f"{HB}/unshare", "-U", "-r", "-n", "/bin/true"], None),
    "unshare -Urmnipuf --mount-proc": ([f"{HB}/unshare", "-U", "-r", "-m", "-n", "-i", "-p", "-u", "-f",
                                        "--mount-proc", "/bin/true"], None),
}

ENV = dict(os.environ, DENO_NO_UPDATE_CHECK="1", NO_COLOR="1")


def run_once(cmd):
    t0 = time.perf_counter()
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, env=ENV)
    _, status, ru = os.wait4(p.pid, 0)
    dt = time.perf_counter() - t0
    p.returncode = status
    return dt * 1000.0, ru.ru_maxrss, status


def read_mem(pid):
    d = {}
    with open(f"/proc/{pid}/smaps_rollup") as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 3 and parts[-1] == "kB":
                d[parts[0].rstrip(":")] = int(parts[1])
    with open(f"/proc/{pid}/status") as f:
        for line in f:
            k, _, v = line.partition(":")
            if k in ("VmSize", "VmRSS", "RssAnon", "RssFile", "RssShmem", "VmHWM"):
                d[k] = int(v.split()[0])
            if k == "Threads":
                d[k] = int(v.split()[0])
    return d


def idle(cmd):
    samples = []
    for _ in range(3):
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, env=ENV)
        time.sleep(SETTLE)
        try:
            samples.append(read_mem(p.pid))
        finally:
            p.kill()
            p.wait()
    keys = samples[0].keys()
    return {k: int(statistics.median(s.get(k, 0) for s in samples)) for k in keys}


def fork_server():
    """Python fork-server: fork a child from a warm parent and measure latency and private memory."""
    import gc
    import json as _j  # noqa: F401
    import asyncio  # noqa: F401
    import urllib.request  # noqa: F401
    import http.client  # noqa: F401
    import ssl  # noqa: F401
    res = {}

    def fork_latency():
        ts = []
        for _ in range(N):
            t0 = time.perf_counter()
            pid = os.fork()
            if pid == 0:
                os._exit(0)
            os.waitpid(pid, 0)
            ts.append((time.perf_counter() - t0) * 1000.0)
        return statistics.median(ts)

    def child_mem(do_gc):
        r, w = os.pipe()
        r2, w2 = os.pipe()
        pid = os.fork()
        if pid == 0:
            os.close(w)
            os.close(r2)
            if do_gc:
                gc.collect()
            _ = sum(range(1000))
            os.write(w2, b"x")
            os.read(r, 1)
            os._exit(0)
        os.close(r)
        os.close(w2)
        os.read(r2, 1)
        time.sleep(0.3)
        m = read_mem(pid)
        os.write(w, b"x")
        os.waitpid(pid, 0)
        return m

    res["parent"] = read_mem(os.getpid())
    res["fork_exit_wait_ms_median"] = fork_latency()
    res["child_small_work"] = child_mem(False)
    res["child_after_gc_collect"] = child_mem(True)
    gc.freeze()
    res["child_after_gc_collect_with_parent_gc_freeze"] = child_mem(True)
    return res


def main():
    out = {"N": N, "settle_s": SETTLE, "results": {}}
    for name, (hello, idlecmd) in R.items():
        try:
            for _ in range(WARM):
                run_once(hello)
            runs = [run_once(hello) for _ in range(N)]
            ts = sorted(r[0] for r in runs)
            rss = sorted(r[1] for r in runs)
            entry = {
                "startup_ms_median": round(statistics.median(ts), 2),
                "startup_ms_p10": round(ts[len(ts) // 10], 2),
                "startup_ms_p90": round(ts[(len(ts) * 9) // 10], 2),
                "maxrss_kb_median": int(statistics.median(rss)),
                "exit_status": runs[0][2],
            }
            if idlecmd:
                entry["idle"] = idle(idlecmd)
            out["results"][name] = entry
        except Exception as e:  # noqa: BLE001
            out["results"][name] = {"error": repr(e)}
        print(name, json.dumps(out["results"][name]), flush=True)

    # Docker (runc) hello-world for container create/start/teardown reference.
    try:
        ts = []
        for i in range(8):
            t0 = time.perf_counter()
            subprocess.run(["docker", "run", "--rm", "--network=none", "hello-world"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            if i >= 2:
                ts.append((time.perf_counter() - t0) * 1000.0)
        out["results"]["docker run --rm hello-world (runc)"] = {
            "startup_ms_median": round(statistics.median(ts), 1),
            "startup_ms_min": round(min(ts), 1), "startup_ms_max": round(max(ts), 1)}
    except Exception as e:  # noqa: BLE001
        out["results"]["docker run --rm hello-world (runc)"] = {"error": repr(e)}

    out["python_fork_server"] = fork_server()
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print("DONE", flush=True)


main()
