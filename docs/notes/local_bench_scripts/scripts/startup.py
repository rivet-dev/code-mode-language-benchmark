import subprocess, time, resource, os, sys, statistics
cmds = {
 "node": ["node", "hello.js"],
 "node --jitless": ["node", "--jitless", "hello.js"],
 "deno": ["deno", "run", "hello.js"],
 "bun": ["bun", "hello.js"],
}
for name, cmd in cmds.items():
    times = []; rss = []
    for i in range(25):
        t0 = time.perf_counter()
        p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _, status, ru = os.wait4(p.pid, 0)
        times.append((time.perf_counter() - t0) * 1000); rss.append(ru.ru_maxrss / 1024)
    times = times[3:]; rss = rss[3:]
    print(f"{name:16s} hello wall ms median={statistics.median(times):6.1f} p90={sorted(times)[int(len(times)*0.9)]:6.1f}  maxRSS MB median={statistics.median(rss):6.1f}")
# idle RSS after 1s for a process that just waits
idle = {"node": ["node", "-e", "setTimeout(()=>{},5000)"], "deno": ["deno", "eval", "setTimeout(()=>{},5000)"], "bun": ["bun", "-e", "setTimeout(()=>{},5000)"]}
for name, cmd in idle.items():
    p = subprocess.Popen(cmd); time.sleep(1.5)
    with open(f"/proc/{p.pid}/status") as f:
        v = [l for l in f if l.startswith("VmRSS")][0].split()[1]
    p.kill(); p.wait()
    print(f"{name:6s} idle VmRSS after 1.5s: {int(v)/1024:.1f} MB")
