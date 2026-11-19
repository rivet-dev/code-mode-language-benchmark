import json, sys
f, key = sys.argv[1], sys.argv[2]
d = json.load(open(f))
items = d if key == "-" else d[key]
sizes = [len(json.dumps(x, separators=(",", ":"))) for x in items]
print(f, "items", len(items), "avg item bytes(minified)", sum(sizes)//len(sizes), "max", max(sizes))
