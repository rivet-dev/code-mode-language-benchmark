import json, sys
for f in sys.argv[1:]:
    try:
        d = json.load(open(f))
    except Exception as e:
        print(f, "parse error", e); continue
    paths = d.get("paths", {})
    ops = sum(1 for p, m in paths.items() for k in m if k.lower() in ("get","put","post","delete","patch","head","options"))
    print(f, "paths", len(paths), "operations", ops, "schemas", len(d.get("components", {}).get("schemas", {})))
