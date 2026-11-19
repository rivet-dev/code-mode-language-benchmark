#!/usr/bin/env python3
"""Runs each engine binary in its own process, one after another, and assembles results.json.

Usage:
  run.py run [engine ...]   run the named engines (default: all) and store results/<engine>.json
  run.py assemble           combine results/*.json and failures into results.json
"""
import datetime
import json
import os
import subprocess
import sys
import time
import zoneinfo

ROOT = os.path.dirname(os.path.abspath(__file__))
ENGINES = ["luau", "quickjs", "rhai", "rune", "koto", "roto", "steel", "starlark", "boa", "monty"]
RESULTS = os.path.join(ROOT, "results")
TIMEOUT_SECONDS = 1800


def loadavg():
    with open("/proc/loadavg") as handle:
        return [float(value) for value in handle.read().split()[:3]]


def binary(engine):
    return os.path.join(ROOT, "target", engine, "release", f"bench-{engine}")


def run(engines):
    os.makedirs(RESULTS, exist_ok=True)
    for engine in engines:
        path = binary(engine)
        failure_path = os.path.join(RESULTS, f"{engine}.failed.json")
        result_path = os.path.join(RESULTS, f"{engine}.json")
        if not os.path.exists(path):
            write(failure_path, {"key": engine, "reason": "binary not built (see logs/build-%s.log)" % engine})
            continue
        before = loadavg()
        started = time.time()
        stderr_path = os.path.join(ROOT, "logs", f"run-{engine}.stderr")
        with open(stderr_path, "w") as stderr:
            try:
                completed = subprocess.run(
                    [path], stdout=subprocess.PIPE, stderr=stderr, timeout=TIMEOUT_SECONDS, text=True
                )
                code = completed.returncode
                stdout = completed.stdout
            except subprocess.TimeoutExpired:
                code = "timeout"
                stdout = ""
        after = loadavg()
        elapsed = time.time() - started
        lines = [line for line in stdout.splitlines() if line.startswith("{")]
        if code == 0 and lines:
            entry = json.loads(lines[-1])
            entry["loadAverage"] = {"before": before, "after": after}
            entry["runSeconds"] = round(elapsed, 1)
            write(result_path, entry)
            if os.path.exists(failure_path):
                os.remove(failure_path)
            print(f"{engine}: ok in {elapsed:.0f}s", flush=True)
        else:
            with open(stderr_path) as handle:
                tail = handle.read()[-2000:]
            write(failure_path, {"key": engine, "reason": f"run failed (exit {code})", "stderrTail": tail})
            print(f"{engine}: FAILED exit={code}", flush=True)


def write(path, value):
    with open(path, "w") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")


def cpu_model():
    with open("/proc/cpuinfo") as handle:
        for line in handle:
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    return "unknown"


def assemble():
    engines = []
    not_measured = []
    measured_times = []
    for engine in ENGINES:
        result_path = os.path.join(RESULTS, f"{engine}.json")
        failure_path = os.path.join(RESULTS, f"{engine}.failed.json")
        if os.path.exists(result_path):
            with open(result_path) as handle:
                entry = json.load(handle)
            previous_path = os.path.join(ROOT, "results-pass1", f"{engine}.json")
            if os.path.exists(previous_path):
                with open(previous_path) as handle:
                    previous = json.load(handle)
                entry["stabilityCheck"] = {
                    "description": "the same binary's primary numbers from an earlier full pass on the same host",
                    **{
                        name: previous[name]
                        for name in ["startUs", "memoryBytesPerSession", "toolCallWallUs", "toolCallCpuUs", "loadAverage"]
                    },
                }
            engines.append(entry)
            measured_times.append(os.path.getmtime(result_path))
        elif os.path.exists(failure_path):
            with open(failure_path) as handle:
                not_measured.append(json.load(handle))
        else:
            not_measured.append({"key": engine, "reason": "not run"})
    notes_path = os.path.join(ROOT, "extra_notes.json")
    if os.path.exists(notes_path):
        with open(notes_path) as handle:
            extra_notes = json.load(handle)
        for entry in engines:
            entry["notes"].extend(extra_notes.get(entry["key"], []))
    extra_path = os.path.join(ROOT, "not_measured_extra.json")
    if os.path.exists(extra_path):
        with open(extra_path) as handle:
            not_measured.extend(json.load(handle))
    rustc = subprocess.run(["rustc", "--version"], stdout=subprocess.PIPE, text=True).stdout.strip()
    built_with = set()
    for engine in ENGINES:
        if os.path.exists(binary(engine)):
            comment = subprocess.run(["readelf", "-p", ".comment", binary(engine)], stdout=subprocess.PIPE, text=True).stdout
            for line in comment.splitlines():
                if "rustc version" in line:
                    built_with.add(line.split("rustc version", 1)[1].strip().rstrip("]").strip())
    if built_with:
        rustc = "rustc " + ", ".join(sorted(built_with)) + " (read from each binary's .comment section)"
    pacific = zoneinfo.ZoneInfo("America/Los_Angeles")
    last = datetime.datetime.fromtimestamp(max(measured_times) if measured_times else time.time(), datetime.timezone.utc)
    first = datetime.datetime.fromtimestamp(min(measured_times) if measured_times else time.time(), datetime.timezone.utc)
    document = {
        "suite": "embedded scripting runtimes in a Rust host (in-process), same start/memory/tool-call definitions as the C Lua harness",
        "rustc": rustc,
        "cpu": {"model": cpu_model(), "logicalCores": os.cpu_count()},
        "measuredAt": last.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "measuredAtPacific": last.astimezone(pacific).strftime("%Y-%m-%d %I:%M %p %Z"),
        "firstEngineFinishedAt": first.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "buildProfile": "release, opt-level=3, lto=fat, codegen-units=1, one standalone crate and target dir per engine",
        "sessionDefinition": "every engine builds its whole engine per session (nothing shared between sessions: no shared engine, compile context, standard library, or runtime), applies its documented limits, registers the host call function, then evaluates 1 + 1 and reads 2 back in Rust; engines with a large immutable part an embedder could share (rune Context, steel prelude, rhai standard package, roto runtime) would start faster and use less memory per session if shared, which is not measured here",
        "stabilityNote": "each entry's stabilityCheck holds the same binary's primary numbers from an earlier full pass on this host minutes before; differences show run-to-run noise on a shared, busy machine",
        "callKind": "sync = the guest calls a registered Rust function on its own stack; async = the guest suspends at the call and the host resumes it with the reply (no Rust callback)",
        "phaseOrder": "each engine runs in its own process: memory first (one warm-up session dropped, malloc_trim, then K live sessions), then start, then tool calls in one session",
        "units": {
            "startUs": "median microseconds from creating a fresh session through reading 1 + 1 == 2 in Rust",
            "memoryBytesPerSession": "RSS growth (/proc/self/statm) per live session after its first response, measured first in a fresh process after malloc_trim",
            "toolCallWallUs": "median of per-batch mean wall time per call, batches of 1,000 calls, after warm-up",
            "toolCallCpuUs": "CLOCK_PROCESS_CPUTIME_ID over all measured calls divided by measured calls",
            "toolCallWallMeanUs": "total measured wall time divided by measured calls (includes GC pauses the median skips)",
            "toolCallSlowestBatchUs": "per-call mean of the slowest 1,000-call batch",
        },
        "engines": engines,
        "notMeasured": not_measured,
    }
    write(os.path.join(ROOT, "results.json"), document)
    print(f"wrote results.json with {len(engines)} engines, {len(not_measured)} not measured")


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "run":
        run(sys.argv[2:] or ENGINES)
    elif command == "assemble":
        assemble()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
