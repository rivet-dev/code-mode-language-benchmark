import json, statistics, subprocess, sys, time, resource
RP = sys.argv[1]
def run(args):
    code = ("import resource, subprocess, sys, time, json\nt=time.perf_counter()\n"
            "r=subprocess.run(json.loads(sys.argv[1]),capture_output=True,text=True)\n"
            "print(json.dumps({'ms':(time.perf_counter()-t)*1000,'rss':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss/1024,'out':r.stdout[-300:],'err':r.stderr[-300:]}))")
    return json.loads(subprocess.run([sys.executable,'-I','-c',code,json.dumps(args)],capture_output=True,text=True).stdout)
def med(args,n=7):
    rs=[run(args) for _ in range(n)]
    return {'median_ms':round(statistics.median(r['ms'] for r in rs),1),'peak_rss_mb':round(statistics.median(r['rss'] for r in rs),1),'out':rs[-1]['out'].strip()[:200],'err':rs[-1]['err'].strip()[-200:]}
out={}
out['version']=med([RP,'-c','import sys; print(sys.version)'],1)['out']
out['pass']=med([RP,'-c','pass'])
out['pass_I_S']=med([RP,'-I','-S','-c','pass'])
out['stdlib_imports']=med([RP,'-c','import time; t=time.perf_counter(); import json, re, datetime, asyncio; print(round((time.perf_counter()-t)*1000,1))'],3)
out['speed']=med([RP,'-c','import time\ndef fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\nt=time.perf_counter(); fib(25); a=(time.perf_counter()-t)*1000\nt=time.perf_counter()\ns=0\nfor i in range(1000000):\n    s += i*i\nb=(time.perf_counter()-t)*1000\nprint(round(a,1), round(b,1))'],3)
out['modules']=med([RP,'-c',"ok=[]\nfor m in ['socket','ssl','urllib.request','http.client','sqlite3','zlib','lzma','ctypes','threading','subprocess','asyncio','hashlib','decimal','zoneinfo','json','re','datetime','dataclasses','csv']:\n    try:\n        __import__(m); ok.append(m)\n    except Exception as e:\n        ok.append('!'+m)\nprint(' '.join(ok))"],1)
print(json.dumps(out,indent=1))
