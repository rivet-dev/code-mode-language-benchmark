import json, sys, time
def rss():
    for l in open('/proc/self/status'):
        if l.startswith('VmRSS'): return int(l.split()[1]) / 1024
out = {}
mode = sys.argv[1]
if mode == 'starlark':
    import starlark as sl
    glb = sl.Globals.standard()
    src = "def loop():\n    s = 0\n    for i in range(1000000):\n        s += i * i\n    return s\nr = loop()\n"
    m = sl.Module(); t = time.perf_counter(); sl.eval(m, sl.parse('a.star', src), glb); out['loop1e6_ms'] = (time.perf_counter() - t) * 1000
    small = "x = {'a': [1, 2, 3]}\ny = str(x)\n"
    r0 = rss(); mods = []; t = time.perf_counter()
    for i in range(1000):
        m = sl.Module(); sl.eval(m, sl.parse('s.star', small), glb); mods.append(m)
    out['avg_module_parse_eval_ms'] = (time.perf_counter() - t)
    out['marginal_rss_per_module_kb'] = (rss() - r0) * 1024 / 1000
    try:
        sl.eval(sl.Module(), sl.parse('r.star', "def f(n):\n    return 1 if n == 0 else f(n-1)\nf(3)\n"), glb); out['recursion'] = 'allowed'
    except Exception as e:
        out['recursion'] = 'rejected: ' + str(e).splitlines()[0][:120]
else:
    from concurrent import interpreters
    r0 = rss(); interps = []; t = time.perf_counter()
    for i in range(20):
        it = interpreters.create(); it.exec("import json, re, datetime\nx = json.dumps({'a': 1})"); interps.append(it)
    out['avg_create_and_exec_ms'] = (time.perf_counter() - t) * 1000 / 20
    out['marginal_rss_per_subinterpreter_mb'] = (rss() - r0) / 20
    try:
        interps[0].exec("import os\nos.listdir('/')"); out['subinterpreter_os_access'] = 'allowed (os.listdir works)'
    except Exception as e:
        out['subinterpreter_os_access'] = 'blocked: ' + str(e)[:100]
print(json.dumps(out))
