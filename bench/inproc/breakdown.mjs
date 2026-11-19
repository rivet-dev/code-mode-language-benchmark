// Prints what one fresh session holds: a V8 isolate's heap versus a QuickJS runtime's heap.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC } from "quickjs-emscripten";

const require = createRequire(import.meta.url);
const ivm = require("isolated-vm");
const here = path.dirname(fileURLToPath(import.meta.url));

const isolate = new ivm.Isolate({ memoryLimit: 128 });
const context = isolate.createContextSync();
context.evalSync("1 + 1");
const v8 = isolate.getHeapStatisticsSync();
console.log("V8 isolate heap:", JSON.stringify({
	total_heap_size: v8.total_heap_size,
	total_physical_size: v8.total_physical_size,
	used_heap_size: v8.used_heap_size,
	total_heap_size_executable: v8.total_heap_size_executable,
	malloced_memory: v8.malloced_memory,
}));
const globalNames = context.evalSync("Object.getOwnPropertyNames(globalThis).length");
console.log("V8 global properties:", globalNames);

const wasmPath = path.join(here, "node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm");
console.log("QuickJS Wasm file bytes (compiled once, shared):", fs.statSync(wasmPath).size);
const wasmModule = await WebAssembly.compile(fs.readFileSync(wasmPath));
const module = await newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmModule }));
const runtime = module.newRuntime();
const quickContext = runtime.newContext();
quickContext.unwrapResult(quickContext.evalCode("1 + 1")).dispose();
const quickGlobals = quickContext.unwrapResult(quickContext.evalCode("Object.getOwnPropertyNames(globalThis).length"));
console.log("QuickJS global properties:", quickContext.getNumber(quickGlobals));
quickGlobals.dispose();
console.log(runtime.dumpMemoryUsage());
