// Checks whether Python code in Pyodide (Node) can reach host capabilities without the `js` module.
import { pathToFileURL } from "node:url";
const [dir, marker] = process.argv.slice(2);
const { loadPyodide } = await import(pathToFileURL(`${dir}/node_modules/pyodide/pyodide.mjs`).href);
const py = await loadPyodide();
// Simulate a host that blocks the JS bridges, as many embedders do.
py.runPython("import sys\nsys.modules['js'] = None\nsys.modules['pyodide_js'] = None");
const r = py.runPython(`
import ctypes
libc = ctypes.CDLL(None)
rc = libc.system(b"echo host-shell-reached > ${marker}")
fn = libc.emscripten_run_script_string
fn.restype = ctypes.c_char_p
v = fn(b"typeof process + ':' + process.version")
f"system_rc={rc} run_script_string={v.decode()}"
`);
console.log(r);
