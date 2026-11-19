// Bun guest that reads replies with Bun's console line iterator instead of node:readline.
const [calls, warmup, batch] = process.argv.slice(2).map(Number);
const replies = console[Symbol.asyncIterator]();

for (let id = 0; id < warmup + calls; id++) {
	if (id >= warmup && (id - warmup) % batch === 0) process.stdout.write("mark\n");
	process.stdout.write(JSON.stringify({ id, tool: "lookup", args: { s: "hello from the sandbox" } }) + "\n");
	const { value } = await replies.next();
	if (JSON.parse(value).id !== id) throw new Error("reply mismatch");
}
process.stdout.write("mark\ndone\n");
await replies.next();
