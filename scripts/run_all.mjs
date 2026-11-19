// Runs every language's benchmarks one after another in a single sitting, then regenerates the
// README results section and the charts.
//
// Usage: node scripts/run_all.mjs [language ...]   (npm run bench -- [language ...])
// Languages run in this order: lua, javascript, python, shell, rust-hosted. Name some to run only
// those. A language that fails keeps its previous results; the run continues and exits non-zero.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANGUAGES = ["lua", "javascript", "python", "shell", "rust-hosted"];
const ENVIRONMENT = path.join(ROOT, "results/raw/environment.json");

const requested = process.argv.slice(2);
const unknown = requested.filter((language) => !LANGUAGES.includes(language));
if (unknown.length > 0) {
	console.error(`unknown language: ${unknown.join(", ")}; choose from ${LANGUAGES.join(", ")}`);
	process.exit(2);
}
const selected = requested.length > 0 ? LANGUAGES.filter((language) => requested.includes(language)) : LANGUAGES;
if (process.versions.node.split(".")[0] !== "22") console.error(`warning: the results were defined on Node 22; this is Node ${process.versions.node}`);

const loadAverage = () => os.loadavg().map((value) => Math.round(value * 100) / 100);
const osName = () => {
	try {
		return fs.readFileSync("/etc/os-release", "utf8").match(/^PRETTY_NAME="?([^"\n]*)"?/m)[1];
	} catch {
		return `${os.type()} ${os.arch()}`;
	}
};

const environment = fs.existsSync(ENVIRONMENT) ? JSON.parse(fs.readFileSync(ENVIRONMENT, "utf8")) : { languages: {} };
environment.host = { cpu: os.cpus()[0].model.trim(), logicalCores: os.cpus().length, os: osName(), kernel: os.release(), node: process.versions.node };

const failed = [];
for (const language of selected) {
	console.error(`\n=== ${language} (load ${loadAverage().join(", ")})`);
	const record = { startedAt: new Date().toISOString(), loadAverage: { start: loadAverage() } };
	const run = spawnSync(process.execPath, [path.join(ROOT, "benches", language, "run.mjs")], { cwd: ROOT, stdio: "inherit" });
	record.finishedAt = new Date().toISOString();
	record.loadAverage.end = loadAverage();
	record.status = run.status === 0 ? "ok" : `failed (${run.status ?? run.signal})`;
	if (run.status !== 0) {
		failed.push(language);
		console.error(`=== ${language} failed; its previous results are kept`);
	}
	environment.languages[language] = record;
	fs.mkdirSync(path.dirname(ENVIRONMENT), { recursive: true });
	fs.writeFileSync(ENVIRONMENT, `${JSON.stringify(environment, null, 2)}\n`);
}

for (const script of ["update_readme.mjs", "render_charts.mjs"]) {
	console.error(`\n=== ${script}`);
	const run = spawnSync(process.execPath, [path.join(ROOT, "scripts", script)], { cwd: ROOT, stdio: "inherit" });
	if (run.status !== 0) failed.push(script);
}

if (failed.length > 0) {
	console.error(`\nfailed: ${failed.join(", ")}`);
	process.exit(1);
}
console.error("\nall benchmarks, the README and the charts are up to date");
