// Checks MicroPython's load, first response, and module registration, printing only error messages.
import { loadMicroPython } from "@micropython/micropython-webassembly-pyscript";

try {
	const mp = await loadMicroPython({ stdout: () => {} });
	console.log("loaded; keys:", Object.keys(mp).join(","));
	mp.runPython("first_response = 1 + 1");
	console.log("globals.get:", typeof mp.globals?.get === "function" ? mp.globals.get("first_response") : "no globals.get");
	mp.registerJsModule("host", { call: async (callProxy) => { const call = callProxy.toJs ? callProxy.toJs() : callProxy; console.log("call type:", call?.constructor?.name, call instanceof Map ? [...call.keys()] : Object.keys(call)); return { id: 0, ok: true, value: 1 }; } });
	await mp.runPythonAsync("import host\nreply = await host.call({'id': 0, 'tool': 'lookup', 'args': {'s': 'hi'}})\nprint(reply.id)");
	console.log("async call ok");
} catch (error) {
	console.log("ERR", String(error?.message ?? error).slice(0, 400));
}
