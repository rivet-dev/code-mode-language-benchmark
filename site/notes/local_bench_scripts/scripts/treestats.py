import json, sys, collections
d = json.load(open(sys.argv[1]))
print("truncated", d.get("truncated"), "entries", len(d.get("tree", [])))
blobs = [e for e in d["tree"] if e["type"] == "blob"]
print("blobs", len(blobs), "total MB %.1f" % (sum(e.get("size", 0) for e in blobs) / 1e6))
lib = [e for e in blobs if e["path"].startswith("Lib/")]
print("Lib/ blobs", len(lib), "Lib/ MB %.1f" % (sum(e.get("size", 0) for e in lib) / 1e6))
ext = collections.Counter(e["path"].rsplit(".", 1)[-1] if "." in e["path"].split("/")[-1] else "(none)" for e in blobs)
print("top ext", ext.most_common(8))
