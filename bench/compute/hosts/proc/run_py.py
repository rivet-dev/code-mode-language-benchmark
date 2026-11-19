# Process runner for CPython: loop inside the runtime, timed with time.perf_counter_ns().
import sys
import time

task_path, data_path, warm, measured = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
namespace = {}
with open(task_path, encoding="utf-8") as handle:
    exec(compile(handle.read(), task_path, "exec"), namespace)
run = namespace["run"]
with open(data_path, encoding="utf-8") as handle:
    text = handle.read()
samples, first, same = [], None, True
for i in range(warm + measured):
    t0 = time.perf_counter_ns()
    out = run(text)
    ms = (time.perf_counter_ns() - t0) / 1e6
    if first is None:
        first = out
    elif out != first:
        same = False
    if i >= warm:
        samples.append(ms)
print("SAMPLES " + ",".join(repr(s) for s in samples))
print("SAME " + ("true" if same else "false"))
print("RESULT " + first)
