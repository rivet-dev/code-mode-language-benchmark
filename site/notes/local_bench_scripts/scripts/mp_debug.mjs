import { pathToFileURL } from "node:url";
const dir = process.argv[2];
const { loadMicroPython } = await import(pathToFileURL(`${dir}/node_modules/@micropython/micropython-webassembly-pyscript/micropython.mjs`).href);
let o = "", e = "";
const mp = await loadMicroPython({ stdout: (s) => (o += s), stderr: (s) => (e += s) });
for (const code of ["x = 1", "print(x)", "def f(n):\n    return n\n", "def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\n", "y = fib(10)", "z = fib(25)"]) {
  try { const r = mp.runPython(code); console.log("ok", JSON.stringify(code), "->", r); } catch (err) { console.log("ERR", JSON.stringify(code), String(err).slice(0,100)); }
}
console.log("stdout:", o.slice(0, 500)); console.log("stderr:", e.slice(0, 500));
