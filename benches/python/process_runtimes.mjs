// CPython runs as a separate process, for the shared process suite (benches/common).
import path from "node:path";
import { fileURLToPath } from "node:url";

const guest = path.join(path.dirname(fileURLToPath(import.meta.url)), "guest.py");

export const PROCESS_RUNTIMES = [
	{ key: "cpython", idle: ["python3", ["-c", "print(1 + 1, flush=True); import sys; sys.stdin.read()"]], guest: ["python3", [guest]] },
];
