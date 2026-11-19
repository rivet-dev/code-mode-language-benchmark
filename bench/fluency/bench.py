"""Code-mode language fluency bench: tasks, fixtures, prompts, bindings, generation, execution, scoring."""
import concurrent.futures as cf, datetime, json, math, os, re, shutil, signal, subprocess, sys, time

ROOT = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
MODEL = "claude-haiku-5-5"
LANGS = ["python", "javascript", "lua", "bash"]
EXT = {"python": "py", "javascript": "mjs", "lua": "lua", "bash": "sh"}

T = {}  # task_id -> dict(text, types, tools, fixture, expected)

# ---------- tasks ----------
T["t01_fanout"] = dict(
    text="Find the total quantity of each SKU across all warehouses. Print one line per SKU whose total is at least 50, formatted as `<sku> <total>`, sorted by total descending, then by SKU ascending for ties.\n\nExample of the format (made-up values):\n```\nrod-8 120\nbracket-2 50\n```",
    types={"StockItem": [("sku", "str", ""), ("qty", "int", "")]},
    tools=[("list_warehouses", [], "str[]", "IDs of all warehouses."),
           ("get_inventory", [("warehouse_id", "str")], "StockItem[]", "Stock records held in one warehouse. A warehouse may hold no stock.")],
    fixture={"inventory": {
        "wh-ams": [{"sku": "bolt-m4", "qty": 40}, {"sku": "nut-m4", "qty": 25}, {"sku": "washer-10", "qty": 60}, {"sku": "gear-12t", "qty": 7}],
        "wh-bos": [{"sku": "bolt-m4", "qty": 15}, {"sku": "spring-s", "qty": 33}, {"sku": "nut-m4", "qty": 25}, {"sku": "hinge-50", "qty": 12}],
        "wh-cdg": [],
        "wh-den": [{"sku": "washer-10", "qty": 5}, {"sku": "gear-12t", "qty": 43}, {"sku": "spring-s", "qty": 17}, {"sku": "clip-3", "qty": 49}],
        "wh-edi": [{"sku": "bolt-m4", "qty": 20}, {"sku": "hinge-50", "qty": 38}, {"sku": "nut-m4", "qty": 25}]}},
    expected="bolt-m4 75\nnut-m4 75\nwasher-10 65\ngear-12t 50\nhinge-50 50\nspring-s 50")

ev = [(1, "alice", "login"), (2, "bob", "login"), (3, "alice", "delete"), (4, "chen", "view"), (5, "bob", "delete"), (6, "alice", "view"),
      (7, "dana", "login"), (8, "chen", "delete"), (9, "alice", "delete"), (10, "eve", "login"), (11, "bob", "edit"), (12, "dana", "delete"), (13, "alice", "logout")]
E = [{"id": i, "user": u, "action": a} for i, u, a in ev]
T["t02_paginate"] = dict(
    text="Read the entire audit log. Print the total number of events on the first line. Then, for every user with at least one `delete` action, print a line `<user> <number of delete actions>`, sorted by that number descending, then by user ascending.",
    types={"Event": [("id", "int", ""), ("user", "str", ""), ("action", "str", "")],
           "EventPage": [("events", "Event[]", ""), ("next_cursor", "str|null", "{null} on the last page")]},
    tools=[("list_events", [("cursor", "str|null=null")], "EventPage", "Returns one page of the audit log, oldest first. Omit the cursor for the first page; pass the previous page's next_cursor to get the next page. A page may contain zero events even when more pages follow. Fails with code INVALID_ARGUMENT for an unknown cursor.")],
    fixture={"pages": [{"events": E[0:4], "next": "p1-xq7"}, {"events": E[4:7], "next": "p2-mt3"}, {"events": [], "next": "p3-ka9"},
                       {"events": E[7:11], "next": "p4-zr2"}, {"events": E[11:13], "next": None}],
             "cursors": {"p1-xq7": 1, "p2-mt3": 2, "p3-ka9": 3, "p4-zr2": 4}},
    expected="13\nalice 2\nbob 1\nchen 1\ndana 1")

T["t03_retry"] = dict(
    text="Fetch the metrics `cpu`, `mem`, `disk`, `net` and `gpu`. A call that fails with code UNAVAILABLE is transient and may succeed if repeated: retry it immediately, making at most 4 attempts in total for that metric. Any other error code is permanent: do not retry it. Print one line per metric in the order listed above: `<name> ok <value> attempts=<n>` if it succeeded, or `<name> failed <code> attempts=<n>` if it did not, where n is the number of calls made for that metric. Finish with a line `total=<sum of the values of the metrics that succeeded>`.",
    types={"MetricValue": [("name", "str", ""), ("value", "int", "")]},
    tools=[("fetch_metric", [("name", "str")], "MetricValue", "Reads the current value of a named metric. Fails with code UNAVAILABLE (transient) or NOT_FOUND (permanent).")],
    fixture={"metrics": {"cpu": [37], "mem": ["UNAVAILABLE", "UNAVAILABLE", 512], "disk": ["UNAVAILABLE"], "net": ["NOT_FOUND"],
                         "gpu": ["UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE", 88]}},
    expected="cpu ok 37 attempts=1\nmem ok 512 attempts=3\ndisk failed UNAVAILABLE attempts=4\nnet failed NOT_FOUND attempts=1\ngpu ok 88 attempts=4\ntotal=637")

emp = [("max", "engineering", 131000, True, "2024-10-05"), ("ben", "engineering", 98000, True, "2020-11-30"), ("pat", "marketing", 61000, True, "2022-11-11"),
       ("ana", "engineering", 120000, True, "2021-03-15"), ("cara", "engineering", 105000, False, "2022-01-10"), ("nia", "sales", 69500, True, "2023-12-12"),
       ("eli", "sales", 64000, True, "2021-01-01"), ("fay", "sales", 71000, True, "2022-08-19"), ("gus", "sales", 59000, True, "2019-05-05"),
       ("ivy", "marketing", 72000, True, "2021-07-07"), ("hal", "marketing", 66000, True, "2024-02-29"), ("jon", "marketing", 58000, False, "2023-03-03"),
       ("kim", "support", 51000, True, "2020-12-31"), ("lee", "support", 53000, True, "2025-01-20"), ("dev", "engineering", 87000, True, "2023-06-01"),
       ("oli", "finance", 90000, False, "2022-02-02"), ("quinn", "marketing", 64500, True, "2021-09-09")]
T["t04_group"] = dict(
    text="Consider only employees who are active and were hired on or after 2021-01-01. Group them by department. Print one line per department that has at least one such employee, sorted by the number of employees descending, then by department name ascending:\n`<dept> count=<n> avg_salary=<average salary rounded down to an integer> names=<their names sorted alphabetically, joined with commas>`\n\nExample of the format (made-up values):\n```\nlegal count=2 avg_salary=70500 names=ann,bo\n```",
    types={"Employee": [("name", "str", ""), ("dept", "str", ""), ("salary", "int", ""), ("active", "bool", ""), ("hired", "str", "date, YYYY-MM-DD")]},
    tools=[("list_employees", [], "Employee[]", "All employee records, in no particular order.")],
    fixture={"employees": [{"name": n, "dept": d, "salary": s, "active": a, "hired": h} for n, d, s, a, h in emp]},
    expected=None)

inv = {"id": "INV-2041", "customer": "Northwind Traders", "tax_bp": 825,
       "lines": [{"description": "Widget", "quantity": 3, "unit_price_cents": 450}, {"description": "Gadget Pro", "quantity": 1, "unit_price_cents": 12999},
                 {"description": "Cable 2m", "quantity": 4, "unit_price_cents": 799}, {"description": "Service fee", "quantity": 1, "unit_price_cents": 2500}]}
T["t05_report"] = dict(
    text="Fetch invoice `INV-2041` and print it in exactly this layout. Line 1: `Invoice <id> for <customer>`. Then one line per invoice line: the description left-aligned and padded with spaces to 14 characters, the quantity right-aligned in 3 characters, one space, then the line total (quantity × unit price) in dollars with exactly 2 decimals, right-aligned in 9 characters. Then three summary lines, each with the label left-aligned and padded to 18 characters followed by the amount in dollars with exactly 2 decimals right-aligned in 9 characters: `Subtotal` (sum of line totals), `Tax` (subtotal × tax_bp / 10000, rounded to the nearest cent) and `Total` (subtotal + tax).\n\nExample of the layout (made-up values):\n```\nInvoice INV-1 for Example Co\nPen             2      2.50\nPaper pack     10     45.00\nSubtotal              47.50\nTax                    2.38\nTotal                 49.88\n```",
    types={"InvoiceLine": [("description", "str", ""), ("quantity", "int", ""), ("unit_price_cents", "int", "")],
           "Invoice": [("id", "str", ""), ("customer", "str", ""), ("tax_bp", "int", "tax rate in basis points: 825 means 8.25%"), ("lines", "InvoiceLine[]", "")]},
    tools=[("get_invoice", [("invoice_id", "str")], "Invoice", "Fetches one invoice. Fails with code NOT_FOUND for an unknown id.")],
    fixture={"invoice": inv}, expected=None)

T["t06_fallback"] = dict(
    text="For each user ID returned by `list_user_ids`, in that order, look the user up with `get_profile`. If that call fails with code NOT_FOUND, look the user up with `get_legacy_profile` instead: the display name is `<first> <last>` and the email is `mail`, or `-` when mail is {null}. If `get_profile` fails with any other code, do not fall back. Print one line per user: `<id> | <display name> | <email> | <source>` where source is `primary` or `legacy`, or `<id> | unresolved | <code of the last error>` when the user could not be resolved. Finish with a line `resolved=<n> unresolved=<m>`.",
    types={"Profile": [("id", "str", ""), ("display_name", "str", ""), ("email", "str", "")],
           "Name": [("first", "str", ""), ("last", "str", "")],
           "LegacyProfile": [("uid", "str", ""), ("name", "Name", ""), ("mail", "str|null", "")]},
    tools=[("list_user_ids", [], "str[]", "IDs of the users to resolve."),
           ("get_profile", [("user_id", "str")], "Profile", "Looks a user up in the primary directory. Fails with code NOT_FOUND if the user is not there, or with another code (for example PERMISSION_DENIED)."),
           ("get_legacy_profile", [("user_id", "str")], "LegacyProfile", "Looks a user up in the legacy directory. Fails with code NOT_FOUND if the user is not there.")],
    fixture={"users": ["u-101", "u-102", "u-103", "u-104", "u-105", "u-106"],
             "primary": {"u-101": {"id": "u-101", "display_name": "Ada Park", "email": "ada@example.com"}, "u-103": "PERMISSION_DENIED",
                         "u-106": {"id": "u-106", "display_name": "Eun Cho", "email": "eun@example.com"}},
             "legacy": {"u-102": {"uid": "u-102", "name": {"first": "Ben", "last": "Ortiz"}, "mail": "bortiz@legacy.example"},
                        "u-103": {"uid": "u-103", "name": {"first": "Cy", "last": "Lam"}, "mail": "cy@legacy.example"},
                        "u-105": {"uid": "u-105", "name": {"first": "Dee", "last": "Shah"}, "mail": None}}},
    expected="u-101 | Ada Park | ada@example.com | primary\nu-102 | Ben Ortiz | bortiz@legacy.example | legacy\nu-103 | unresolved | PERMISSION_DENIED\nu-104 | unresolved | NOT_FOUND\nu-105 | Dee Shah | - | legacy\nu-106 | Eun Cho | eun@example.com | primary\nresolved=4 unresolved=2")

T["t07_concurrency"] = dict(
    text="Probe every host returned by `list_hosts`. If the language can run calls concurrently, run the probes concurrently with at most 3 in flight at any moment; otherwise run them one at a time. Then print the hosts whose status is not 200, one per line as `<host> <status>`, sorted by host name, followed by a final line `healthy=<number of hosts with status 200> max_latency=<largest latency_ms among hosts with status 200>`.",
    types={"ProbeResult": [("host", "str", ""), ("status", "int", ""), ("latency_ms", "int", "")]},
    tools=[("list_hosts", [], "str[]", "Names of all hosts."),
           ("probe", [("host", "str")], "ProbeResult", "Checks one host; takes about 0.3 seconds. The service allows at most 3 probe calls in flight at once: a probe call made while 3 are already in flight fails with code RATE_LIMITED, and after that every later probe call also fails with RATE_LIMITED.")],
    fixture={"hosts": {"web-4": [200, 210], "db-1": [200, 340], "web-1": [200, 120], "queue-1": [429, 50], "web-3": [503, 30], "cache-1": [200, 12],
                       "search-1": [200, 299], "web-6": [500, 15], "auth-1": [200, 77], "web-2": [200, 95], "db-2": [200, 305], "web-5": [200, 88]}},
    expected="queue-1 429\nweb-3 503\nweb-6 500\nhealthy=9 max_latency=340")

exps = [("e1", "travel", 420.10, "USD"), ("e2", "meals", 38.50, "EUR"), ("e3", "travel", 15800, "JPY"), ("e4", "lodging", 310.40, "GBP"),
        ("e5", "meals", 42.75, "USD"), ("e6", "lodging", 189.30, "CHF"), ("e7", "travel", 89.90, "EUR"), ("e8", "software", 120.20, "USD"),
        ("e9", "meals", 2350, "JPY"), ("e10", "software", 49.60, "GBP")]
rates = {"USD": 1.0842, "GBP": 0.8571, "JPY": 162.37, "CHF": 0.9468}
T["t08_arithmetic"] = dict(
    text="Convert every expense to EUR: divide its amount by the rate of its currency; amounts in EUR need no conversion. For each category, sorted by category name, print `<category> <total in EUR with exactly 2 decimals>`. Then print `TOTAL <sum of all expenses in EUR with exactly 2 decimals>` and `MAX <id of the expense with the largest EUR amount> <that EUR amount with exactly 2 decimals>`. Sum the unrounded converted amounts and round only when printing.",
    types={"Rates": [("base", "str", "always \"EUR\""), ("rates", "map<float>", "units of each currency per 1 EUR; EUR itself is not listed")],
           "Expense": [("id", "str", ""), ("category", "str", ""), ("amount", "float", "in the expense's currency"), ("currency", "str", "ISO code, e.g. \"USD\"")]},
    tools=[("get_rates", [], "Rates", "Current exchange rates."), ("list_expenses", [], "Expense[]", "All expenses.")],
    fixture={"rates": rates, "expenses": [{"id": i, "category": c, "amount": a, "currency": cur} for i, c, a, cur in exps]},
    expected=None)

LOG = """2026-03-14T09:15:02Z ERROR checkout: payment declined {code=PAY-4021 user=u-1182 took=342ms}
2026-03-14T09:15:07Z INFO search: query served {took=88ms}
2026-03-14T09:16:11Z WARN checkout: retrying gateway call
2026-03-14T09:16:12Z ERROR inventory: stock sync failed {code=INV-17 took=1203ms}
2026-03-14T09:17:40Z ERROR checkout: payment declined {code=PAY-4021 user=u-2290 took=298ms}

2026-03-14T09:18:03Z INFO checkout: order placed {user=u-1182 took=156ms}
2026-03-14T09:18:30Z ERROR search: index unavailable {code=SRCH-5 took=15ms}
2026-03-14T09:19:45Z ERROR checkout: address invalid {code=ADDR-2 user=u-3301}
2026-03-14T09:20:00Z DEBUG inventory: cache warm {took=4ms}
2026-03-14T09:21:13Z ERROR inventory: stock sync failed {code=INV-17 took=1450ms}
2026-03-14T09:22:05Z ERROR search: upstream timeout
"""
T["t09_parse"] = dict(
    text="Parse the log. Each non-empty line is `<timestamp> <LEVEL> <component>: <message>`, optionally followed by a space and `{key=value key=value ...}` at the end of the line. Timestamps, levels and component names contain no spaces; messages contain no braces; keys and values contain no spaces, braces or `=`. Ignore empty lines. For each component with at least one ERROR line, print `<component> errors=<number of ERROR lines> codes=<distinct values of the code key on its ERROR lines, sorted, joined with commas>`, sorted by component. Then print `slowest <component> <took>` for the line (any level) with the largest `took` value, where took looks like `342ms`.",
    types={}, tools=[("read_log", [], "str", "The raw log text: lines separated by newline characters, ending with a newline.")],
    fixture={"log": LOG},
    expected="checkout errors=3 codes=ADDR-2,PAY-4021\ninventory errors=2 codes=INV-17\nsearch errors=2 codes=SRCH-5\nslowest inventory 1450ms")

T["t10_chain"] = dict(
    text="For each task ID returned by `list_open_tasks`, in that order, build its breadcrumb by following parent_id links up to the root task (one whose parent_id is {null}). Print one line per open task: `<id>: <titles from the root down to the task, joined with ' > '>`. Each task may be fetched with `get_task` at most once per run, so reuse results you already have.",
    types={"Task": [("id", "str", ""), ("title", "str", ""), ("parent_id", "str|null", "{null} for a root task")]},
    tools=[("list_open_tasks", [], "str[]", "IDs of the open tasks."),
           ("get_task", [("task_id", "str")], "Task", "Fetches one task. Fetching the same task a second time in a run fails with code DUPLICATE_REQUEST.")],
    fixture={"open": ["T-9", "T-4", "T-12", "T-7"],
             "tasks": {"T-1": ["Platform", None], "T-2": ["Billing", "T-1"], "T-3": ["Invoices", "T-2"], "T-4": ["Fix rounding", "T-3"],
                       "T-5": ["Search", "T-1"], "T-6": ["Indexing", "T-5"], "T-7": ["Reindex nightly", "T-6"], "T-8": ["Mobile", None],
                       "T-9": ["Login screen", "T-8"], "T-10": ["Payments", "T-2"], "T-11": ["Refunds", "T-10"], "T-12": ["Partial refunds", "T-11"]}},
    expected="T-9: Mobile > Login screen\nT-4: Platform > Billing > Invoices > Fix rounding\nT-12: Platform > Billing > Payments > Refunds > Partial refunds\nT-7: Platform > Search > Indexing > Reindex nightly")


def ref_expected():
    g = {}
    for e in T["t04_group"]["fixture"]["employees"]:
        if e["active"] and e["hired"] >= "2021-01-01":
            g.setdefault(e["dept"], []).append(e)
    rows = sorted(g.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    T["t04_group"]["expected"] = "\n".join(
        f"{d} count={len(es)} avg_salary={sum(e['salary'] for e in es) // len(es)} names={','.join(sorted(e['name'] for e in es))}" for d, es in rows)
    c = lambda x: f"{x // 100}.{x % 100:02d}"
    out = [f"Invoice {inv['id']} for {inv['customer']}"]
    sub = 0
    for l in inv["lines"]:
        lt = l["quantity"] * l["unit_price_cents"]; sub += lt
        out.append(f"{l['description']:<14}{l['quantity']:>3} {c(lt):>9}")
    tax = (sub * inv["tax_bp"] + 5000) // 10000
    out += [f"{'Subtotal':<18}{c(sub):>9}", f"{'Tax':<18}{c(tax):>9}", f"{'Total':<18}{c(sub + tax):>9}"]
    T["t05_report"]["expected"] = "\n".join(out)
    cat, best, tot = {}, None, 0.0
    for i, cg, a, cur in exps:
        v = a if cur == "EUR" else a / rates[cur]
        cat[cg] = cat.get(cg, 0.0) + v; tot += v
        if best is None or v > best[1]:
            best = (i, v)
        for x in [v]:
            assert abs(x * 100 - math.floor(x * 100) - 0.5) > 1e-3
    for x in list(cat.values()) + [tot]:
        assert abs(x * 100 - math.floor(x * 100) - 0.5) > 1e-3, x
    T["t08_arithmetic"]["expected"] = "\n".join([f"{k} {cat[k]:.2f}" for k in sorted(cat)] + [f"TOTAL {tot:.2f}", f"MAX {best[0]} {best[1]:.2f}"])


# ---------- type rendering ----------
PRIM = {"python": {"str": "str", "int": "int", "float": "float", "bool": "bool"},
        "javascript": {"str": "string", "int": "number", "float": "number", "bool": "boolean"},
        "lua": {"str": "string", "int": "integer", "float": "number", "bool": "boolean"},
        "bash": {"str": "string", "int": "integer", "float": "number", "bool": "boolean"}}
NULL = {"python": "None", "javascript": "null", "lua": "nil", "bash": "null"}


def ty(t, lang):
    if t.endswith("|null"):
        inner = ty(t[:-5], lang)
        return {"python": f"{inner} | None", "javascript": f"{inner} | null", "lua": f"{inner}|nil", "bash": f"{inner} or null"}[lang]
    if t.endswith("[]"):
        inner = ty(t[:-2], lang)
        return {"python": f"list[{inner}]", "javascript": f"{inner}[]", "lua": f"{inner}[]", "bash": f"array of {inner}"}[lang]
    if t.startswith("map<"):
        inner = ty(t[4:-1], lang)
        return {"python": f"dict[str, {inner}]", "javascript": f"Record<string, {inner}>", "lua": f"table<string, {inner}>", "bash": f"object mapping string to {inner}"}[lang]
    return PRIM[lang].get(t, t)


def sub_null(s, lang):
    return s.replace("{null}", NULL[lang])


def render_tools(task, lang):
    out = []
    for name, fields in task["types"].items():
        if lang == "python":
            out.append(f"class {name}(TypedDict):\n" + "\n".join(f"    {f}: {ty(t, lang)}" + (f"  # {sub_null(c, lang)}" if c else "") for f, t, c in fields))
        elif lang == "javascript":
            out.append(f"type {name} = {{\n" + "\n".join(f"  {f}: {ty(t, lang)};" + (f" // {c2}" if (c2 := ', '.join(x for x in ['integer' if t == 'int' else '', sub_null(c, lang)] if x)) else "") for f, t, c in fields) + "\n};")
        elif lang == "lua":
            out.append(f"---@class {name}\n" + "\n".join(f"---@field {f} {ty(t, lang)}" + (f" {sub_null(c, lang)}" if c else "") for f, t, c in fields))
        else:
            out.append(f"{name}: {{" + ", ".join(f"\"{f}\": {ty(t, lang)}" + (f" ({sub_null(c, lang)})" if c else "") for f, t, c in fields) + "}")
    for name, params, ret, doc in task["tools"]:
        doc = sub_null(doc, lang)
        opt = [p for p in params if p[1].endswith("=null")]
        if lang == "python":
            ps = ", ".join(f"{p}: {ty(t.replace('=null', ''), lang)}" + (" = None" if t.endswith("=null") else "") for p, t in params)
            out.append(f"def {name}({ps}) -> {ty(ret, lang)}:\n    \"\"\"{doc}\"\"\"")
        elif lang == "javascript":
            ps = ", ".join(f"{p}{'?' if t.endswith('=null') else ''}: {ty(t.replace('=null', ''), lang)}" for p, t in params)
            out.append(f"/** {doc} */\ntools.{name}({ps}): Promise<{ty(ret, lang)}>;")
        elif lang == "lua":
            ps = "\n".join(f"---@param {p}{'?' if t.endswith('=null') else ''} {ty(t.replace('=null', '').replace('|null', ''), lang)}" for p, t in params)
            out.append(f"---{doc}\n" + (ps + "\n" if ps else "") + f"---@return {ty(ret, lang)}\nfunction tools.{name}({', '.join(p for p, _ in params)}) end")
        else:
            ps = " ".join(f"[{p.upper()}]" if t.endswith("=null") else p.upper() for p, t in params)
            out.append(f"{name} {ps}".rstrip() + f"\n    {doc}" + f"\n    Prints: {ty(ret, lang)} (JSON)")
    fence = {"python": "python", "javascript": "ts", "lua": "lua", "bash": "text"}[lang]
    return f"```{fence}\n" + "\n\n".join(out) + "\n```"


LANG_NAME = {"python": "Python 3.15", "javascript": "JavaScript (Node.js 22)", "lua": "Lua 5.5", "bash": "bash 5.2"}
INTRO = {
    "python": "The script runs as `python3 script.py` with Python 3.15 and the standard library only. The tools are synchronous functions in a module named `tools`, which is already on the import path (`import tools`). Results are plain Python values decoded from JSON. If a call fails, the function raises `tools.ToolError`, an `Exception` subclass with string attributes `code` and `message`.",
    "javascript": "The script runs as an ES module with Node.js 22 (`node script.mjs`), so top-level `await` works; only built-in Node modules are available. The tools are async functions on a global object named `tools` (no import needed); each returns a Promise. Results are plain JavaScript values decoded from JSON. If a call fails, its Promise rejects with a `ToolError` (a global `Error` subclass) that has string properties `code` and `message`.",
    "lua": "The script runs with Lua 5.5 and the standard libraries only. The tools are synchronous functions in a global table named `tools`, set up by a prelude before the script starts (no `require` needed). Results are Lua values decoded from JSON: objects become tables with string keys, arrays become sequences starting at index 1, and JSON null becomes nil (the field is absent). If a call fails, the function raises an error whose value is a table with string fields `code` and `message`; catch it with `pcall`.",
    "bash": "The script runs as `bash script.sh` with GNU bash 5.2. Besides bash builtins you may use standard command-line utilities (coreutils, grep, sed, awk) and jq 1.7; do not run other language interpreters such as python, perl or node. Each tool is a command on PATH that takes its parameters as positional arguments. On success it prints its result as one line of JSON to stdout and exits with status 0. On failure it prints nothing to stdout, prints one line of JSON `{\"code\": \"...\", \"message\": \"...\"}` to stderr, and exits with status 1.",
}
OUTPUT = {"python": "Print the final answer to stdout (for example with `print`), and nothing else.",
          "javascript": "Print the final answer to stdout (for example with `console.log`), and nothing else.",
          "lua": "Print the final answer to stdout (for example with `print` or `io.write`), and nothing else.",
          "bash": "Print the final answer to stdout (for example with `echo` or `printf`), and nothing else."}


def prompt(tid, lang):
    t = T[tid]
    return (f"Write a {LANG_NAME[lang]} script for the task below. The script runs non-interactively and calls host-provided tools (\"code mode\").\n\n"
            f"## Task\n{sub_null(t['text'], lang)}\n\n## Tools\n{INTRO[lang]}\n\n{render_tools(t, lang)}\n\n"
            f"## Output\n{OUTPUT[lang]} Output written to stderr is ignored. Surrounding whitespace is ignored; everything else must match exactly. The script is killed after 10 seconds.\n\n"
            "Reply with only the complete script in a single fenced code block.")


# ---------- bindings ----------
def write_bindings(tid):
    t, b = T[tid], os.path.join(ROOT, "bindings", tid)
    th = os.path.join(ROOT, "toolhost.py")
    os.makedirs(b + "/py", exist_ok=True); os.makedirs(b + "/bin", exist_ok=True)
    names = [x[0] for x in t["tools"]]
    py = [f"import json as _j, subprocess as _s\nclass ToolError(Exception):\n    def __init__(self, code, message):\n        super().__init__(f'{{code}}: {{message}}'); self.code = code; self.message = message\n"
          f"def _call(name, args):\n    p = _s.run([{PY!r}, '-I', '-S', {th!r}, 'envelope', name, _j.dumps(args)], capture_output=True, text=True)\n    e = _j.loads(p.stdout)\n    if e['ok']: return e['value']\n    raise ToolError(e['error']['code'], e['error']['message'])\n"]
    for name, params, _, _ in t["tools"]:
        sig = ", ".join(p + ("=None" if ty_.endswith("=null") else "") for p, ty_ in params)
        py.append(f"def {name}({sig}):\n    return _call({name!r}, [{', '.join(p for p, _ in params)}])\n")
    open(b + "/py/tools.py", "w").write("\n".join(py))
    js = (f"import {{ execFile }} from 'node:child_process';\nclass ToolError extends Error {{ constructor(code, message) {{ super(message); this.name = 'ToolError'; this.code = code; }} }}\n"
          f"const call = (name, args) => new Promise((res, rej) => execFile({json.dumps(PY)}, ['-I', '-S', {json.dumps(th)}, 'envelope', name, JSON.stringify(args.map(a => a === undefined ? null : a))], (err, out) => {{\n"
          f"  if (err && !out) return rej(err); const e = JSON.parse(out); e.ok ? res(e.value) : rej(new ToolError(e.error.code, e.error.message)); }}));\n"
          f"globalThis.ToolError = ToolError;\nglobalThis.tools = {{\n" + "".join(f"  {n}: (...a) => call('{n}', a),\n" for n in names) + "};\n")
    open(b + "/prelude.mjs", "w").write(js)
    lua = (f"local PY, TH = {json.dumps(PY)}, {json.dumps(th)}\nlocal function q(s) return \"'\" .. s:gsub(\"'\", \"'\\\\''\") .. \"'\" end\n"
           "local function enc(v) if v == nil then return 'null' elseif type(v) == 'number' then return tostring(v) else return '\"' .. tostring(v):gsub('[\"\\\\]', '\\\\%0') .. '\"' end end\n"
           "local EM = {__tostring = function(e) return e.code .. ': ' .. e.message end}\n"
           "local function call(name, n, ...) local a = table.pack(...) local parts = {} for i = 1, n do parts[i] = enc(a[i]) end\n"
           "  local p = io.popen(PY .. ' -I -S ' .. q(TH) .. ' lua ' .. name .. ' ' .. q('[' .. table.concat(parts, ',') .. ']'), 'r') local out = p:read('a') p:close()\n"
           "  local e = load('return ' .. out, '=tool', 't', {})() if e.ok then return e.value end error(setmetatable(e.error, EM), 2) end\n"
           "local tools = {}\n" + "".join(f"function tools.{n}(...) return call('{n}', {len(p)}, ...) end\n" for n, p, _, _ in t["tools"]) + "return tools\n")
    open(b + "/tools.lua", "w").write(lua)
    for n in names:
        p = f"{b}/bin/{n}"
        open(p, "w").write(f"#!/bin/sh\nexec {PY} -I -S {th} cli {n} \"$@\"\n"); os.chmod(p, 0o755)


# ---------- generation ----------
def generate(tid, lang):
    d = os.path.join(ROOT, "runs", MODEL, lang, tid)
    os.makedirs(d, exist_ok=True)
    if os.path.exists(d + "/response.md"):
        return
    env = dict(os.environ, CLAUDE_CODE_DISABLE_AUTO_MEMORY="1")
    t0 = time.time()
    p = subprocess.run(["claude", "-p", prompt(tid, lang), "--model", MODEL, "--tools", "", "--strict-mcp-config", "--setting-sources", "",
                        "--system-prompt", "You are a helpful assistant.", "--no-session-persistence", "--output-format", "text"],
                       cwd=os.path.join(ROOT, "gen-cwd"), env=env, capture_output=True, text=True, timeout=300, stdin=subprocess.DEVNULL)
    json.dump({"exit": p.returncode, "stderr": p.stderr[-2000:], "seconds": round(time.time() - t0, 1)}, open(d + "/gen.json", "w"))
    open(d + "/response.md", "w").write(p.stdout)


# ---------- execution ----------
def extract(text):
    m = re.search(r"^```[^\n`]*\n(.*?)^```", text, re.S | re.M)
    return m.group(1) if m else None


def run(tid, lang):
    d = os.path.join(ROOT, "runs", MODEL, lang, tid)
    code = extract(open(d + "/response.md").read())
    res = {"task": tid, "language": lang}
    if code is None:
        res["category"] = "no_code_block"; return res
    sp = os.path.join(d, "script." + EXT[lang]); open(sp, "w").write(code)
    b = os.path.join(ROOT, "bindings", tid)
    chk = {"python": [PY, "-c", "import sys;compile(open(sys.argv[1]).read(),sys.argv[1],'exec')", sp], "javascript": ["node", "--check", sp],
           "lua": ["luac", "-p", sp], "bash": ["bash", "-n", sp]}[lang]
    c = subprocess.run(chk, capture_output=True, text=True)
    if c.returncode != 0:
        res.update(category="syntax_error", detail=c.stderr[-500:]); open(d + "/stderr.txt", "w").write(c.stderr); return res
    work = os.path.join(d, "work"); shutil.rmtree(work, ignore_errors=True); os.makedirs(work + "/state")
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": work, "TMPDIR": work, "LANG": "C.UTF-8", "BENCH_TASK": tid,
           "BENCH_STATE_DIR": work + "/state", "BENCH_FIXTURES": os.path.join(ROOT, "fixtures")}
    cmd = {"python": [PY, sp], "javascript": [shutil.which("node"), "--import", "file://" + b + "/prelude.mjs", sp], "lua": [shutil.which("lua"), "-l", "tools", sp], "bash": ["bash", sp]}[lang]
    if lang == "python": env["PYTHONPATH"] = b + "/py"; env["PYTHONDONTWRITEBYTECODE"] = "1"
    if lang == "lua": env["LUA_PATH"] = b + "/?.lua"; env["LUA_CPATH"] = ""
    if lang == "bash": env["PATH"] = b + "/bin:" + env["PATH"]
    if lang == "javascript": env["PATH"] = os.path.dirname(shutil.which("node")) + ":" + env["PATH"]
    t0 = time.time()
    p = subprocess.Popen(cmd, cwd=work, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        out, err = p.communicate(timeout=10); to = False
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL); out, err = p.communicate(); to = True
    open(d + "/stdout.txt", "w").write(out); open(d + "/stderr.txt", "w").write(err)
    ok = (not to) and out.strip() == T[tid]["expected"].strip()
    cat = "success" if ok else "timeout" if to else "runtime_error" if p.returncode != 0 else "wrong_answer"
    res.update(category=cat, exit=p.returncode, seconds=round(time.time() - t0, 2))
    return res


def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    ph = k / n; den = 1 + z * z / n; c = (ph + z * z / (2 * n)) / den; h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den
    return (round(c - h, 4), round(c + h, 4))


def main():
    ref_expected()
    os.makedirs(ROOT + "/fixtures", exist_ok=True); os.makedirs(ROOT + "/prompts", exist_ok=True)
    for tid, t in T.items():
        json.dump(t["fixture"], open(f"{ROOT}/fixtures/{tid}.json", "w"), indent=1)
        json.dump({"id": tid, "text": t["text"], "tools": t["tools"], "types": t["types"], "expected": t["expected"]}, open(f"{ROOT}/fixtures/{tid}.task.json", "w"), indent=1)
        write_bindings(tid)
        for lang in LANGS:
            open(f"{ROOT}/prompts/{tid}.{lang}.txt", "w").write(prompt(tid, lang))
    if "prompts-only" in sys.argv: return
    jobs = [(tid, lang) for tid in T for lang in LANGS]
    with cf.ThreadPoolExecutor(10) as ex:
        list(ex.map(lambda j: generate(*j), jobs))
    with cf.ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda j: run(*j), jobs))
    json.dump(results, open(ROOT + "/runs/scored.json", "w"), indent=1)
    entries = []
    for lang in LANGS:
        rs = [r for r in results if r["language"] == lang]
        k = sum(r["category"] == "success" for r in rs); lo, hi = wilson(k, len(rs))
        fc = {c: sum(r["category"] == c for r in rs) for c in ["syntax_error", "runtime_error", "wrong_answer", "timeout", "no_code_block"]}
        entries.append({"language": lang, "model": MODEL, "samples": len(rs), "successes": k, "rate": round(k / len(rs), 4), "wilsonLow": lo, "wilsonHigh": hi, "failureCounts": fc,
                        "perTask": {r["task"]: r["category"] for r in rs}})
    json.dump({"measuredAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "models": [MODEL], "entries": entries,
               "notes": ""}, open(ROOT + "/results.json", "w"), indent=1)
    for e in entries:
        print(e["language"], e["successes"], "/", e["samples"], e["wilsonLow"], e["wilsonHigh"], e["failureCounts"], e["perTask"])


main()
