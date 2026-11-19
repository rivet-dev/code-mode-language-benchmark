// Node, Deno and Bun run as separate processes, for the shared process suite (benches/common).
// idle.mjs answers 1 + 1 with each runtime's own console; guest.mjs makes the tool calls.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const idle = path.join(here, "idle.mjs");
const guest = path.join(here, "guest.mjs");

export const PROCESS_RUNTIMES = [
	{ key: "node", idle: ["node", [idle]], guest: ["node", [guest]] },
	{ key: "deno", idle: ["deno", ["run", "--quiet", idle]], guest: ["deno", ["run", "--quiet", guest]] },
	{ key: "bun", idle: ["bun", [idle]], guest: ["bun", [guest]] },
];
