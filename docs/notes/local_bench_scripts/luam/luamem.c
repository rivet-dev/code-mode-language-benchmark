#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <signal.h>
#include "lua.h"
#include "lualib.h"
#include "lauxlib.h"
typedef struct { size_t cur, peak, cap; } Ctr;
static void *ca(void *ud, void *ptr, size_t osize, size_t nsize) {
  Ctr *c = ud; size_t old = ptr ? osize : 0;
  if (nsize == 0) { free(ptr); c->cur -= old; return NULL; }
  if (c->cap && c->cur - old + nsize > c->cap) return NULL;
  void *p = realloc(ptr, nsize);
  if (p) { c->cur = c->cur - old + nsize; if (c->cur > c->peak) c->peak = c->cur; }
  return p;
}
static lua_State *mk(Ctr *c) {
#if LUA_VERSION_NUM >= 505
  return lua_newstate(ca, c, 12345);
#else
  return lua_newstate(ca, c);
#endif
}
static void req(lua_State *L, const char *n, lua_CFunction f) {
#if LUA_VERSION_NUM >= 502
  luaL_requiref(L, n, f, 1); lua_pop(L, 1);
#else
  lua_pushcfunction(L, f); lua_pushstring(L, n); lua_call(L, 1, 0);
#endif
}
static void open_safe(lua_State *L) {
  req(L, "_G", luaopen_base); req(L, LUA_STRLIBNAME, luaopen_string);
  req(L, LUA_TABLIBNAME, luaopen_table); req(L, LUA_MATHLIBNAME, luaopen_math);
#if LUA_VERSION_NUM >= 502
  req(L, LUA_COLIBNAME, luaopen_coroutine); req(L, LUA_UTF8LIBNAME, luaopen_utf8);
#endif
}
static long rss(void){ long a,b; FILE*f=fopen("/proc/self/statm","r"); fscanf(f,"%ld %ld",&a,&b); fclose(f); return b*sysconf(_SC_PAGESIZE);} 
static double now(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec*1e9+t.tv_nsec; }
static int noop(lua_State *L){ (void)L; return 0; }
static int echo(lua_State *L){ size_t n; const char *s = luaL_checklstring(L,1,&n); lua_pushlstring(L,s,n); return 1; }
static int budget;
static void hook(lua_State *L, lua_Debug *ar){ (void)ar; if (--budget <= 0) luaL_error(L, "instruction budget exceeded"); }
static void onalarm(int s){ (void)s; const char m[]="TIMEOUT: count hook never fired (loop not interrupted)\n"; write(1,m,sizeof m-1); _exit(2);} 
static double runloop(lua_State *L, const char *code){ double t0=now(); if (luaL_dostring(L, code)) { printf("err: %s\n", lua_tostring(L,-1)); lua_pop(L,1);} return now()-t0; }
int main(int argc, char **argv){
  const char *mode = argc>1?argv[1]:"all";
  if (!strcmp(mode,"hook")) {
    Ctr c={0}; lua_State *L=mk(&c); luaL_openlibs(L);
    if (argc>2 && !strcmp(argv[2],"jitoff")) luaL_dostring(L, "if jit then jit.off() end");
    signal(SIGALRM,onalarm); alarm(5); budget=100000; lua_sethook(L,hook,LUA_MASKCOUNT,1000);
    double t0=now(); int r=luaL_dostring(L,"local i=0 while true do i=i+1 end");
    printf("hook test (%s): rc=%d msg=%s after %.0f ms\n", argc>2?argv[2]:"default", r, r?lua_tostring(L,-1):"", (now()-t0)/1e6); return 0;
  }
  printf("%s\n", LUA_RELEASE);
  { Ctr c={0}; lua_State *L=mk(&c); size_t e=c.cur; open_safe(L); size_t s=c.cur; lua_close(L);
    Ctr c2={0}; lua_State *L2=mk(&c2); luaL_openlibs(L2); size_t a=c2.cur; lua_close(L2);
    printf("heap bytes: bare state=%zu, safe libs(base,string,table,math,coroutine,utf8)=%zu, all libs=%zu\n", e, s, a); }
  int N=1000; long r0=rss(); lua_State **Ls=malloc(sizeof(*Ls)*N); Ctr *cs=calloc(N,sizeof(Ctr));
  for(int i=0;i<N;i++){ Ls[i]=mk(&cs[i]); open_safe(Ls[i]); }
  long r1=rss(); printf("RSS delta per live state with safe libs (N=%d): %.0f bytes\n", N, (double)(r1-r0)/N);
  double t0=now(); for(int i=0;i<10000;i++){ Ctr cc={0}; lua_State *l=mk(&cc); open_safe(l); lua_close(l);} 
  printf("create+open safe libs+close: %.2f us per state\n", (now()-t0)/1e3/10000);
  lua_State *L=Ls[0];
  luaL_dostring(L,"collectgarbage() collectgarbage() local a=collectgarbage('count') local t={} for i=1,10000 do local co=coroutine.create(function(x) local y=coroutine.yield(x) return y end) coroutine.resume(co,i) t[i]=co end collectgarbage() local b=collectgarbage('count') KEEP=t return (b-a)*1024/10000");
  printf("heap bytes per suspended coroutine (N=10000): %.0f\n", lua_tonumber(L,-1)); lua_pop(L,1);
  lua_register(L,"noop",noop); lua_register(L,"echo",echo);
  double base=runloop(L,"for i=1,10000000 do end");
  double tn=runloop(L,"local f=noop for i=1,10000000 do f(i) end");
  double te=runloop(L,"local f=echo for i=1,10000000 do f('hello world') end");
  printf("host call cost: noop(i) %.1f ns/call, echo(11-byte string) %.1f ns/call (loop overhead %.1f ns/iter subtracted)\n", (tn-base)/1e7, (te-base)/1e7, base/1e7);
  { Ctr c={0}; c.cap=1<<20; lua_State *M=mk(&c); open_safe(M);
    luaL_dostring(M,"local ok,e=pcall(function() local t={} for i=1,1e8 do t[i]=i end end) return tostring(ok)..' / '..tostring(e)");
    printf("1 MiB cap: %s ; peak=%zu ; ", lua_tostring(M,-1), c.peak); lua_pop(M,1);
    luaL_dostring(M,"return 40+2"); printf("state usable after OOM: %s\n", lua_tostring(M,-1)); lua_close(M); }
  return 0;
}
