// Answers one JSON tool call per stdin line, the way a sandboxed process would reply to its host.
// A line of {"cmd":"cpu"} returns this process's CPU usage so the host can count both sides.
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
	const call = JSON.parse(line);
	if (call.cmd === "cpu") {
		process.stdout.write(JSON.stringify({ cpu: process.cpuUsage() }) + "\n");
		return;
	}
	process.stdout.write(JSON.stringify({ id: call.id, ok: true, value: call.args.s.length }) + "\n");
});
