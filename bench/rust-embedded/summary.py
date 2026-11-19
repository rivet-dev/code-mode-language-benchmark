"""Prints one line per engine result in a results directory (default: results/)."""
import glob
import json
import os
import sys

directory = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
for path in sorted(glob.glob(os.path.join(directory, "*.json"))):
    d = json.load(open(path))
    if "startUs" not in d:
        print(os.path.basename(path), d.get("reason"))
        continue
    load = d["loadAverage"]
    print(
        f"{d['key']:9} start={d['startUs']:>11.3f}us runs={d['startRuns']:>4} "
        f"mem={d['memoryBytesPerSession']:>9} K={d['memorySessions']:>4} {d['memoryStoppedBy']:>13} "
        f"wall={d['toolCallWallUs']:.4f} mean={d['toolCallWallMeanUs']:.4f} cpu={d['toolCallCpuUs']:.4f} "
        f"slow={d['toolCallSlowestBatchUs']:.2f} N={d['toolCallMeasuredCalls']} "
        f"load={load['before'][0]}->{load['after'][0]}"
    )
