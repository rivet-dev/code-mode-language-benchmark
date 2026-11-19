// Deno guest using Deno-native I/O: async stdin reads split into lines, synchronous stdout writes.
const [calls, warmup, batch] = Deno.args.map(Number);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const chunk = new Uint8Array(65536);
let pending = "";

async function readLine() {
	for (;;) {
		const newline = pending.indexOf("\n");
		if (newline >= 0) {
			const line = pending.slice(0, newline);
			pending = pending.slice(newline + 1);
			return line;
		}
		const count = await Deno.stdin.read(chunk);
		if (count === null) return null;
		pending += decoder.decode(chunk.subarray(0, count));
	}
}

const write = (text) => Deno.stdout.writeSync(encoder.encode(text));
for (let id = 0; id < warmup + calls; id++) {
	if (id >= warmup && (id - warmup) % batch === 0) write("mark\n");
	write(JSON.stringify({ id, tool: "lookup", args: { s: "hello from the sandbox" } }) + "\n");
	const line = await readLine();
	if (JSON.parse(line).id !== id) throw new Error("reply mismatch");
}
write("mark\ndone\n");
await readLine();
