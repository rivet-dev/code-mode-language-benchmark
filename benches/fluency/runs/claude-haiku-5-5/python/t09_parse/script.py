import re
import tools

LINE_RE = re.compile(r'^(\S+) (\S+) ([^\s:]+): ?(.*?)(?: \{([^{}]*)\})?$')
TOOK_RE = re.compile(r'^(\d+(?:\.\d+)?)(ns|us|ms|s)$')
UNIT_MS = {"ns": 1e-6, "us": 1e-3, "ms": 1.0, "s": 1000.0}


def parse_took(value):
    m = TOOK_RE.match(value)
    if not m:
        return None
    return float(m.group(1)) * UNIT_MS[m.group(2)]


def main():
    text = tools.read_log()

    errors = {}  # component -> [error_count, set_of_codes]
    slowest = None  # (ms, component, original_took_text)

    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        m = LINE_RE.match(line)
        if not m:
            continue
        _ts, level, comp, _msg, kv = m.groups()

        kvs = {}
        if kv:
            for item in kv.split():
                if "=" in item:
                    k, v = item.split("=", 1)
                    kvs[k] = v

        if level == "ERROR":
            entry = errors.setdefault(comp, [0, set()])
            entry[0] += 1
            if "code" in kvs:
                entry[1].add(kvs["code"])

        if "took" in kvs:
            ms = parse_took(kvs["took"])
            if ms is not None and (slowest is None or ms > slowest[0]):
                slowest = (ms, comp, kvs["took"])

    out = []
    for comp in sorted(errors):
        count, codes = errors[comp]
        out.append(f"{comp} errors={count} codes={','.join(sorted(codes))}")
    if slowest is not None:
        out.append(f"slowest {slowest[1]} {slowest[2]}")

    print("\n".join(out))


if __name__ == "__main__":
    main()
