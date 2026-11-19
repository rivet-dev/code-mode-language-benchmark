// Compute task runner shared by the language folders: parse and aggregate 3 MB of JSON.
//
// Each runtime runs the task WARM + MEASURED times in one process. The first WARM runs are
// discarded and the rest are timed. Embedded hosts time the call that passes the JSON text in and
// gets the result text back; process runners time the loop inside the runtime with its own clock.
// Every runtime prints three lines, SAMPLES, SAME and RESULT, and the result must match the
// reference checksum in data/meta.json.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const WARM = 2;
export const MEASURED = 7;
export const DATA_PATH = path.join(here, "data/orders.json");
const META_PATH = path.join(here, "data/meta.json");

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const loadAverage = () => os.loadavg().map((value) => Math.round(value * 100) / 100);
const median = (s) => { const a = [...s].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const p90 = (s) => { const a = [...s].sort((x, y) => x - y); return a[Math.ceil(0.9 * a.length) - 1]; };
const r3 = (x) => Math.round(x * 1000) / 1000;

/** Sorts region keys and turns revenues into integer cents, so float formatting cannot differ. */
function canonical(resultText) {
	const r = JSON.parse(resultText);
	return JSON.stringify({
		revenueByRegion: Object.fromEntries(Object.keys(r.revenueByRegion).sort().map((k) => [k, Math.round(r.revenueByRegion[k] * 100)])),
		topCustomers: r.topCustomers.map((e) => [e.customer, Math.round(e.revenue * 100)]),
		ordersWithMoreThan3Items: r.ordersWithMoreThan3Items,
	});
}

/**
 * Returns the dataset's reference metadata, generating data/orders.json first when it is missing
 * or stale. The generator is deterministic, so a regenerated file must match the committed hash.
 */
export function ensureDataset() {
	const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
	if (fs.existsSync(DATA_PATH) && sha(fs.readFileSync(DATA_PATH)) === meta.sha256) return meta;
	const generated = spawnSync(process.execPath, [path.join(here, "gen_data.mjs")], { encoding: "utf8" });
	if (generated.status !== 0) throw new Error(`gen_data.mjs failed: ${generated.stderr}`);
	const regenerated = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
	if (sha(fs.readFileSync(DATA_PATH)) !== meta.sha256 || regenerated.expectedChecksum !== meta.expectedChecksum) {
		fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
		throw new Error("gen_data.mjs produced a dataset that does not match data/meta.json");
	}
	return meta;
}

/**
 * Runs each runtime once, one after another, and returns one entry per runtime. A runtime is
 * { key, command, args }; WARM and MEASURED are appended to its arguments. Throws if a runtime
 * fails or its result does not match the reference checksum.
 */
export function runCompute(runtimes) {
	const meta = ensureDataset();
	const entries = {};
	for (const runtime of runtimes) {
		const started = { at: new Date().toISOString(), load: loadAverage() };
		console.error(`[compute] ${runtime.key}`);
		const proc = spawnSync(runtime.command, [...runtime.args, String(WARM), String(MEASURED)], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 600000 });
		const finished = { at: new Date().toISOString(), load: loadAverage() };
		const line = (tag) => (proc.stdout || "").split("\n").find((l) => l.startsWith(tag + " "))?.slice(tag.length + 1);
		if (proc.status !== 0) {
			throw new Error(`compute ${runtime.key} exit ${proc.status ?? proc.error}: ${(proc.stderr || "").trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`);
		}
		const samples = line("SAMPLES").split(",").map(Number);
		const checksum = sha(canonical(line("RESULT")));
		const ok = checksum === meta.expectedChecksum && line("SAME") === "true";
		if (!ok) throw new Error(`compute ${runtime.key}: checksum mismatch (${checksum}) or runs differed`);
		entries[runtime.key] = {
			medianMs: r3(median(samples)),
			p90Ms: r3(p90(samples)),
			runs: samples.length,
			warmupRuns: WARM,
			resultChecksumOk: ok,
			resultChecksum: checksum,
			allRunsIdentical: line("SAME") === "true",
			samplesMs: samples.map(r3),
			started,
			finished,
		};
		console.error(`[compute] ${runtime.key}: median ${entries[runtime.key].medianMs} ms, p90 ${entries[runtime.key].p90Ms} ms, checksum ok`);
	}
	return {
		dataset: { records: meta.records, bytes: meta.bytes, sha256: meta.sha256, seed: meta.seed, generator: "gen_data.mjs (mulberry32)", expectedResultChecksum: meta.expectedChecksum },
		method: {
			warmupRuns: WARM,
			measuredRuns: MEASURED,
			median: "middle value (mean of the two middle for even counts)",
			p90: "nearest rank",
			checksum: "sha256 of a canonical form of the returned JSON (sorted region keys, revenues as integer cents, top-5 order kept), compared against an exact integer-cents reference",
		},
		entries,
	};
}
