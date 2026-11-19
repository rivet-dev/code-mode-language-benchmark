// Answers 1 + 1 as its first response, then stays alive until stdin closes.
import process from "node:process";

process.stdout.write(`${1 + 1}\n`);
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
