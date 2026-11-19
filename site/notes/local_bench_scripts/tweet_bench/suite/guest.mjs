// Sandbox side of the tool-call benchmark for Node, Deno, and Bun.
// Calls the host over stdio one JSON call at a time and prints "mark" before each timed batch.
import process from "node:process";
import readline from "node:readline";

const [calls, warmup, batch] = process.argv.slice(2).map(Number);
const replies = readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();

for (let id = 0; id < warmup + calls; id++) {
	if (id >= warmup && (id - warmup) % batch === 0) process.stdout.write("mark\n");
	process.stdout.write(JSON.stringify({ id, tool: "lookup", args: { s: "hello from the sandbox" } }) + "\n");
	const { value } = await replies.next();
	if (JSON.parse(value).id !== id) throw new Error("reply mismatch");
}
process.stdout.write("mark\ndone\n");
await replies.next();
