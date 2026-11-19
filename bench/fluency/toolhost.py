"""Mock tool host. Usage: toolhost.py MODE TOOL ARGS_JSON|positional...
MODE: envelope (JSON envelope), lua (Lua literal envelope), cli (bash: value on stdout, error on stderr + exit 1).
Env: BENCH_TASK, BENCH_STATE_DIR, BENCH_FIXTURES."""
import fcntl, json, os, sys, time

TASK = os.environ["BENCH_TASK"]
STATE = os.environ["BENCH_STATE_DIR"]
FIX = json.load(open(os.path.join(os.environ["BENCH_FIXTURES"], TASK + ".json")))


class Fail(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def locked(fn):
    with open(os.path.join(STATE, "lock"), "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        p = os.path.join(STATE, "state.json")
        st = json.load(open(p)) if os.path.exists(p) else {}
        out = fn(st)
        json.dump(st, open(p, "w"))
        return out


def call(tool, args):
    f = FIX
    if tool == "list_warehouses":
        return list(f["inventory"].keys())
    if tool == "get_inventory":
        if args[0] not in f["inventory"]:
            raise Fail("NOT_FOUND", "unknown warehouse")
        return f["inventory"][args[0]]
    if tool == "list_events":
        cur = args[0] if args and args[0] not in (None, "") else None
        idx = 0 if cur is None else f["cursors"].get(cur)
        if idx is None:
            raise Fail("INVALID_ARGUMENT", "unknown cursor")
        page = f["pages"][idx]
        return {"events": page["events"], "next_cursor": page["next"]}
    if tool == "fetch_metric":
        name = args[0]
        seq = f["metrics"].get(name)
        if seq is None:
            raise Fail("NOT_FOUND", "unknown metric")
        n = locked(lambda st: st.__setitem__(name, st.get(name, 0) + 1) or st[name])
        step = seq[min(n, len(seq)) - 1]
        if isinstance(step, str):
            raise Fail(step, "metric read failed")
        return {"name": name, "value": step}
    if tool == "list_employees":
        return f["employees"]
    if tool == "get_invoice":
        if args[0] != f["invoice"]["id"]:
            raise Fail("NOT_FOUND", "unknown invoice")
        return f["invoice"]
    if tool == "list_user_ids":
        return f["users"]
    if tool in ("get_profile", "get_legacy_profile"):
        tbl = f["primary" if tool == "get_profile" else "legacy"]
        v = tbl.get(args[0], "NOT_FOUND")
        if isinstance(v, str):
            raise Fail(v, "lookup failed")
        return v
    if tool == "list_hosts":
        return list(f["hosts"].keys())
    if tool == "probe":
        def enter(st):
            if st.get("banned") or st.get("inflight", 0) >= 3:
                st["banned"] = True
                return False
            st["inflight"] = st.get("inflight", 0) + 1
            st["max"] = max(st.get("max", 0), st["inflight"])
            return True
        if not locked(enter):
            raise Fail("RATE_LIMITED", "too many concurrent probes")
        time.sleep(0.3)
        locked(lambda st: st.__setitem__("inflight", st["inflight"] - 1))
        h = f["hosts"].get(args[0])
        if h is None:
            raise Fail("NOT_FOUND", "unknown host")
        return {"host": args[0], "status": h[0], "latency_ms": h[1]}
    if tool == "get_rates":
        return {"base": "EUR", "rates": f["rates"]}
    if tool == "list_expenses":
        return f["expenses"]
    if tool == "read_log":
        return f["log"]
    if tool == "list_open_tasks":
        return f["open"]
    if tool == "get_task":
        tid = args[0]
        dup = locked(lambda st: st.setdefault("seen", []).count(tid) > 0 or st["seen"].append(tid))
        if dup:
            raise Fail("DUPLICATE_REQUEST", "task already fetched in this run")
        t = f["tasks"].get(tid)
        if t is None:
            raise Fail("NOT_FOUND", "unknown task")
        return {"id": tid, "title": t[0], "parent_id": t[1]}
    raise Fail("UNKNOWN_TOOL", tool)


def lua_lit(v):
    if v is None:
        return "nil"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return '"' + "".join(c if (32 <= ord(c) < 127 and c not in '"\\') else "\\%03d" % ord(c) for c in v) + '"'
    if isinstance(v, list):
        return "{" + ",".join(lua_lit(x) for x in v) + "}"
    return "{" + ",".join("[%s]=%s" % (lua_lit(k), lua_lit(x)) for k, x in v.items() if x is not None) + "}"


def main():
    mode, tool = sys.argv[1], sys.argv[2]
    args = json.loads(sys.argv[3]) if mode != "cli" else sys.argv[3:]
    with open(os.path.join(STATE, "calls.jsonl"), "a") as log:
        log.write(json.dumps({"t": time.time(), "tool": tool, "args": args}) + "\n")
    try:
        env = {"ok": True, "value": call(tool, args)}
    except Fail as e:
        env = {"ok": False, "error": {"code": e.code, "message": e.message}}
    if mode == "envelope":
        print(json.dumps(env))
    elif mode == "lua":
        print(lua_lit(env))
    else:
        if env["ok"]:
            print(json.dumps(env["value"]))
        else:
            print(json.dumps(env["error"]), file=sys.stderr)
            sys.exit(1)


main()
