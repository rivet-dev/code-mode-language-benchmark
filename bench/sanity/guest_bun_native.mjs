// Bun guest using only Bun-native I/O: the console line iterator and a flushed stdout writer.
const [calls, warmup, batch] = process.argv.slice(2).map(Number);
const replies = console[Symbol.asyncIterator]();
const out = Bun.stdout.writer();

for (let id = 0; id < warmup + calls; id++) {
	if (id >= warmup && (id - warmup) % batch === 0) out.write("mark\n");
	out.write(JSON.stringify({ id, tool: "lookup", args: { s: "hello from the sandbox" } }) + "\n");
	await out.flush();
	const { value } = await replies.next();
	if (JSON.parse(value).id !== id) throw new Error("reply mismatch");
}
out.write("mark\ndone\n");
await out.flush();
await replies.next();
