"""CPython fork from a warm parent: time to first response and private memory per child."""
import gc
import json
import os
import statistics
import sys
import time

START_RUNS = 40
MEMORY_CHILDREN = 20


def memory_bytes(pid):
    """Returns (private, proportional) memory in bytes for a live process."""
    fields = {}
    with open(f"/proc/{pid}/smaps_rollup") as rollup:
        for line in rollup:
            parts = line.split()
            if len(parts) >= 3 and parts[-1] == "kB":
                fields[parts[0].rstrip(":")] = int(parts[1]) * 1024
    return fields["Private_Clean"] + fields["Private_Dirty"], fields["Pss"]


def cgroup_charged_bytes():
    """Returns the memory charged to this process's cgroup, or None outside a cgroup v2 scope."""
    with open("/proc/self/cgroup") as cgroup:
        relative = cgroup.read().strip().split(":")[-1]
    try:
        with open(f"/sys/fs/cgroup{relative}/memory.current") as current:
            return int(current.read())
    except OSError:
        return None


def fork_child(hold):
    """Forks a child that answers 1 + 1 over a pipe; with hold, it then waits to be released."""
    answer_read, answer_write = os.pipe()
    release_read, release_write = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(answer_read)
        os.close(release_write)
        os.write(answer_write, f"{1 + 1}\n".encode())
        if hold:
            os.read(release_read, 1)
        os._exit(0)
    os.close(answer_write)
    os.close(release_read)
    return pid, answer_read, release_write


def main():
    # A zygote freezes its warmed-up heap so children do not copy it on the first collection.
    gc.collect()
    gc.freeze()

    samples = []
    for run in range(START_RUNS + 2):
        started = time.perf_counter_ns()
        pid, answer, release = fork_child(hold=False)
        reply = os.read(answer, 16)
        elapsed_ms = (time.perf_counter_ns() - started) / 1e6
        if reply.strip() != b"2":
            raise SystemExit(f"unexpected answer {reply!r}")
        os.close(answer)
        os.close(release)
        os.waitpid(pid, 0)
        if run >= 2:
            samples.append(elapsed_ms)

    time.sleep(0.3)
    charged_before = cgroup_charged_bytes()
    children = [fork_child(hold=True) for _ in range(MEMORY_CHILDREN)]
    for _, answer, _ in children:
        if os.read(answer, 16).strip() != b"2":
            raise SystemExit("child did not answer")
    time.sleep(0.5)
    charged_after = cgroup_charged_bytes()
    readings = [memory_bytes(pid) for pid, _, _ in children]

    # Each child inherited the release pipes of the children forked before it, so release the
    # newest first: a child sees EOF only after every later child holding a copy has exited.
    for pid, answer, release in reversed(children):
        os.close(release)
        os.close(answer)
        os.waitpid(pid, 0)

    print(json.dumps({
        "python": sys.version.split()[0],
        "startMs": round(statistics.median(samples), 3),
        "ussBytes": statistics.median(private for private, _ in readings),
        "pssBytes": statistics.median(proportional for _, proportional in readings),
        "cgroupBytesPerChild": None if charged_before is None else round((charged_after - charged_before) / MEMORY_CHILDREN),
    }))


main()
