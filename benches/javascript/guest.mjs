// Sandbox side of the tool-call benchmark for Node, Deno and Bun, using each runtime's own
// stdin reader: node:readline makes Bun spin, so Bun and Deno read lines natively.
const args = globalThis.Deno ? Deno.args : process.argv.slice(2);
const [calls, warmup, batch] = args.map(Number);

let nextLine;
if (globalThis.Bun) {
	const lines = console[Symbol.asyncIterator]();
	nextLine = async () => (await lines.next()).value;
} else if (globalThis.Deno) {
	const reader = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader();
	let buffered = "";
	nextLine = async () => {
		for (;;) {
			const newline = buffered.indexOf("\n");
			if (newline >= 0) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				return line;
			}
			const { value, done } = await reader.read();
			if (done) return undefined;
			buffered += value;
		}
	};
} else {
	const readline = await import("node:readline");
	const lines = readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
	nextLine = async () => (await lines.next()).value;
}

for (let id = 0; id < warmup + calls; id++) {
	if (id >= warmup && (id - warmup) % batch === 0) console.log("mark");
	console.log(JSON.stringify({ id, tool: "lookup", args: { s: "hello from the sandbox" } }));
	if (JSON.parse(await nextLine()).id !== id) throw new Error("reply mismatch");
}
console.log("mark");
console.log("done");
await nextLine();
