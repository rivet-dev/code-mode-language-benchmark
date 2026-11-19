// Answers 1 + 1 as its first response with each runtime's own console, then stays alive until
// stdin closes. Node-compat stdout costs Bun about 15 ms at startup, so it is avoided here.
console.log(1 + 1);

if (globalThis.Bun) {
	for await (const _line of console) {
		// Drain stdin until it closes.
	}
} else if (globalThis.Deno) {
	for await (const _chunk of Deno.stdin.readable) {
		// Drain stdin until it closes.
	}
} else {
	process.stdin.resume();
	process.stdin.on("end", () => process.exit(0));
}
