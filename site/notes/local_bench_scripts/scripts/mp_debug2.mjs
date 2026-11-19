import { pathToFileURL } from "node:url";
const dir = process.argv[2];
const { loadMicroPython } = await import(pathToFileURL(`${dir}/node_modules/@micropython/micropython-webassembly-pyscript/micropython.mjs`).href);
const a = await loadMicroPython({ stdout: () => {} });
try { a.runPython("x = 1"); console.log("a ok before b"); } catch (e) { console.log("a ERR before b", String(e).slice(0,80)); }
const b = await loadMicroPython({ stdout: () => {} });
try { b.runPython("x = 2"); console.log("b ok"); } catch (e) { console.log("b ERR", String(e).slice(0,80)); }
try { a.runPython("x = 3"); console.log("a ok after b"); } catch (e) { console.log("a ERR after b", String(e).slice(0,80)); }
try { a.runPython("def g(n):\n    return n\ny = g(3)"); console.log("a ok call after b"); } catch (e) { console.log("a ERR call after b", String(e).slice(0,80)); }
