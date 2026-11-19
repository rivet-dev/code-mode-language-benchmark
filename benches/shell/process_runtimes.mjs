// bash and dash run as separate processes, for the shared process suite (benches/common).
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROCESS_RUNTIMES = [
	{ key: "bash", idle: ["bash", ["-c", "echo $((1 + 1)); read -r _"]], guest: ["bash", [path.join(here, "guest.sh")]] },
	{ key: "dash", idle: ["dash", ["-c", "echo $((1 + 1)); read _"]], guest: ["dash", [path.join(here, "guest_dash.sh")]] },
];
