import json, sys, glob, ast
rows=[]
for f in sorted(glob.glob(sys.argv[1]+"/rows_*.json")):
    rows += [r["row"] for r in json.load(open(f))["rows"]]
want = "hmac gzip zlib xml yaml struct pickle openpyxl xlwt docx PIL lxml Crypto cryptography secrets uuid tarfile html difflib textwrap unicodedata mimetypes email smtplib flask wordcloud folium networkx sympy tensorflow keras torch Levenshtein texttable queue threading multiprocessing asyncio concurrent".split()
n=len(rows)
libsets=[set(ast.literal_eval(r["libs"])) for r in rows]
for w in want:
    k=sum(1 for s in libsets if w in s)
    if k: print(f"{w:16s} {k:4d} {100*k/n:4.1f}%")
# solution length stats
lens=[len(r["canonical_solution"].splitlines()) for r in rows]
lens.sort(); print("solution lines median", lens[n//2], "p90", lens[int(n*0.9)], "max", lens[-1])
