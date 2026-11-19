"""Sandbox side of the tool-call benchmark for CPython: one JSON call at a time over stdio."""
import json
import sys

calls, warmup, batch = (int(value) for value in sys.argv[1:4])
out, inp = sys.stdout, sys.stdin

for call_id in range(warmup + calls):
    if call_id >= warmup and (call_id - warmup) % batch == 0:
        out.write("mark\n")
    out.write(json.dumps({"id": call_id, "tool": "lookup", "args": {"s": "hello from the sandbox"}}) + "\n")
    out.flush()
    reply = json.loads(inp.readline())
    if reply["id"] != call_id:
        raise SystemExit("reply mismatch")

out.write("mark\ndone\n")
out.flush()
inp.read()
