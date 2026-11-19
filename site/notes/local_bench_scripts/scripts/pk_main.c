// PocketPy 2.2.0 harness: per-VM RSS, speed, and watchdog.
#include "pocketpy.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
static double rss_mb(void){ FILE* f=fopen("/proc/self/status","r"); char l[256]; double v=0; while(fgets(l,sizeof l,f)) if(!strncmp(l,"VmRSS:",6)) { v=atof(l+6)/1024; } fclose(f); return v; }
static double now_ms(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec*1e3+t.tv_nsec/1e6; }
static void run(const char* src){ if(!py_exec(src,"<bench>",EXEC_MODE,NULL)) py_printexc(); }
int main(void){
  double r0=rss_mb(); double t=now_ms();
  py_initialize();
  printf("{\"init_ms\": %.2f, \"rss_after_init_mb\": %.2f, \"rss_before_mb\": %.2f,", now_ms()-t, rss_mb(), r0);
  double r1=rss_mb(); t=now_ms();
  for(int i=1;i<16;i++){ py_switchvm(i); run("d = {'a': [1, 2, 3]}\nimport json\ns = json.dumps(d)"); }
  printf(" \"avg_new_vm_ms\": %.3f, \"marginal_rss_per_vm_mb\": %.3f,", (now_ms()-t)/15, (rss_mb()-r1)/15);
  py_switchvm(0);
  t=now_ms(); run("def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\nfib(25)"); printf(" \"fib25_ms\": %.1f,", now_ms()-t);
  t=now_ms(); run("s = 0\nfor i in range(1000000):\n    s += i * i"); printf(" \"loop1e6_ms\": %.1f,", now_ms()-t);
  py_watchdog_begin(200); t=now_ms(); bool ok = py_exec("while True:\n    pass", "<wd>", EXEC_MODE, NULL); py_watchdog_end();
  printf(" \"watchdog_fired\": %s, \"watchdog_ms\": %.1f}\n", ok ? "false" : "true", now_ms()-t);
  if(!ok) py_clearexc(NULL);
  run("mods=[]\nfor m in ['json','re','datetime','time','math','random','collections','os','io','base64','hashlib','asyncio','dataclasses','typing','functools','itertools']:\n    try:\n        __import__(m); mods.append(m)\n    except:\n        mods.append('!'+m)\nprint(' '.join(mods))");
  py_finalize(); return 0;
}
