import json, sys, glob, ast, collections
rows = []
for f in sorted(glob.glob(sys.argv[1] + "/rows_*.json")):
    d = json.load(open(f))
    rows += [r["row"] for r in d.get("rows", [])]
print("rows", len(rows))
print("fields", list(rows[0].keys()))
c = collections.Counter()
nlibs = []
for r in rows:
    libs = r.get("libs")
    if isinstance(libs, str):
        try: libs = ast.literal_eval(libs)
        except Exception: libs = []
    libs = sorted(set(libs or []))
    nlibs.append(len(libs))
    c.update(libs)
n = len(rows)
print("avg libs/task %.2f" % (sum(nlibs)/n))
for lib, k in c.most_common(45):
    print(f"{lib:20s} {k:5d} {100*k/n:5.1f}%")
# domain-ish groupings
groups = {
 "data (pandas/numpy/scipy/sklearn/statistics)": {"pandas","numpy","scipy","sklearn","statistics","statsmodels"},
 "viz (matplotlib/seaborn)": {"matplotlib","seaborn"},
 "text/regex (re/string/nltk/textblob/collections?)": {"re","string","nltk","textblob","unicodedata","difflib","wordninja","texttable"},
 "time (datetime/time/pytz/dateutil/calendar/holidays)": {"datetime","time","pytz","dateutil","calendar","holidays"},
 "files/os (os/glob/shutil/pathlib/subprocess/zipfile/tarfile)": {"os","glob","shutil","pathlib","subprocess","zipfile","tarfile","fnmatch","tempfile","io","sys","platform","psutil"},
 "serialization (json/csv/pickle/xml/yaml/base64/struct/codecs/binascii)": {"json","csv","pickle","xml","yaml","base64","struct","codecs","binascii","xmltodict","openpyxl","xlwt","docx","pyquery","lxml"},
 "network/web (requests/urllib/bs4/socket/smtplib/ftplib/http/ssl/flask/mechanize)": {"requests","urllib","bs4","socket","smtplib","ftplib","http","ssl","flask","flask_mail","flask_restful","flask_login","flask_wtf","mechanize","ipaddress","email","cgi","wtforms","werkzeug","django"},
 "crypto/hash (hashlib/hmac/secrets/cryptography/rsa/Crypto/base64)": {"hashlib","hmac","secrets","cryptography","rsa","Crypto","bcrypt"},
 "compression (gzip/zlib/zipfile/tarfile)": {"gzip","zlib","zipfile","tarfile","bz2","lzma"},
 "image (PIL/cv2/skimage)": {"PIL","cv2","skimage","imageio"},
}
for g, s in groups.items():
    k = sum(1 for r in rows if set(ast.literal_eval(r["libs"]) if isinstance(r["libs"], str) else r["libs"]) & s)
    print(f"{g:80s} {k:5d} {100*k/n:5.1f}%")
