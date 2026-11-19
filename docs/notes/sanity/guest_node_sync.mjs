// Node guest with blocking reads and writes on fds 0 and 1, the shape of the Lua and Python guests.
import fs from "node:fs";

const [calls, warmup, batch] = process.argv.slice(2).map(Number);
const chunk = Buffer.alloc(65536);
let pending = "";

function readLine() {
	for (;;) {
		const newline = pending.indexOf("\n");
		if (newline >= 0) {
			const line = pending.slice(0, newline);
			pending = pending.slice(newline + 1);
			return line;
		}
		let count;
		try {
			count = fs.readSync(0, chunk, 0, chunk.length, null);
		} catch (error) {
			if (error.code === "EAGAIN") continue;
			throw error;
		}
		if (count === 0) return null;
		pending += chunk.toString("utf8", 0, count);
	}
}

const write = (text) => fs.writeSync(1, text);
for (let id = 0; id < warmup + calls; id++) {
	if (id >= warmup && (id - warmup) % batch === 0) write("mark\n");
	write(JSON.stringify({ id, tool: "lookup", args: { s: "hello from the sandbox" } }) + "\n");
	if (JSON.parse(readLine()).id !== id) throw new Error("reply mismatch");
}
write("mark\ndone\n");
readLine();
