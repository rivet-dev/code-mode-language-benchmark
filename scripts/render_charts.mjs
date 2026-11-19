// Regenerates charts/*.png from results/*.json.
//
// Builds charts/src/combined.json from the normalized results, serves charts/ on loopback, and
// captures each figure on the chart pages with headless Chromium over the DevTools protocol:
//   combined.html?only=combined -> combined.png (three panels, 4000 x 2000)
//   combined.html?only=single   -> metric-{memory,start,tool-call,density,compute}.png (3900 x 2600)
//   scatter.html                -> scatter.png (3900 x 2600)
// Chromium runs with a throwaway profile. Set CHROMIUM to choose the browser binary.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHARTS = path.join(ROOT, "charts");
const RESULTS = path.join(ROOT, "results");
const KIB = 1024;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

// Charted runtimes, in column order: embedded first, then separate processes. The Lua process
// rows and the Rust-hosted engines stay in the results and the README table only.
const COLUMNS = [
	{ runtime: "lua", logo: "lua" },
	{ runtime: "luajit", logo: "luajit" },
	{ runtime: "quickjs", logo: "quickjs" },
	{ runtime: "v8", logo: "v8" },
	{ runtime: "micropython", logo: "micropython" },
	{ runtime: "pyodide", logo: "pyodide" },
	{ runtime: "dash", logo: "dash" },
	{ runtime: "bash", logo: "bash" },
	{ runtime: "cpython-fork", logo: "cpython" },
	{ runtime: "cpython", logo: "cpython" },
	{ runtime: "node", logo: "nodejs" },
	{ runtime: "bun", logo: "bun" },
	{ runtime: "deno", logo: "deno" },
];

const JOBS = [
	{ page: "combined.html?only=combined", scale: 1.25, width: 3400 },
	{ page: "combined.html?only=single", scale: 2.6, width: 1600 },
	{ page: "scatter.html", scale: 2.6, width: 1600 },
];

function compactBytes(bytes) {
	if (bytes < MIB) return `${Math.round(bytes / KIB)} KiB`;
	return bytes < 10 * MIB ? `${(bytes / MIB).toFixed(1)} MiB` : `${Math.round(bytes / MIB)} MiB`;
}

function compactMs(ms) {
	if (ms < 1) return `${Math.round(ms * 1e3)} µs`;
	if (ms >= 1000) return `${(ms / 1e3).toFixed(1)} s`;
	return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

function compactUs(us) {
	if (us >= 1000) return `${(us / 1e3).toFixed(1)} ms`;
	if (us < 1) return `${us.toFixed(2)} µs`;
	return us < 10 ? `${us.toFixed(1)} µs` : `${Math.round(us)} µs`;
}

/** Formats a count of instances compactly: 65k, 4.1k, 925. */
function compactCount(count) {
	if (count >= 10000) return `${Math.round(count / 1000)}k`;
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(Math.round(count));
}

/** Builds the data both chart pages read, in the shape they were written for. */
function buildChartData() {
	const columns = COLUMNS.map(({ runtime, logo }) => {
		const file = path.join(RESULTS, `${runtime}.json`);
		if (!fs.existsSync(file)) throw new Error(`results/${runtime}.json is missing; run npm run bench first`);
		const result = JSON.parse(fs.readFileSync(file, "utf8"));
		const { memoryBytes, startMs, toolCallUs, computeMs } = result.metrics;
		const column = {
			key: runtime,
			group: result.group,
			name: result.label,
			logo,
			memory: { value: memoryBytes, label: compactBytes(memoryBytes) },
			density: { value: GIB / memoryBytes, label: compactCount(GIB / memoryBytes) },
			start: { value: startMs * 1e3, label: compactMs(startMs) },
			toolCall: toolCallUs === null ? null : { value: toolCallUs, label: compactUs(toolCallUs) },
		};
		// Single-metric charts leave out columns with no compute entry.
		if (computeMs !== null) column.compute = { value: computeMs, label: compactMs(computeMs) };
		return column;
	});
	return {
		title: "Scripting for code mode",
		panels: [
			{ key: "memory", title: "Base memory per invocation", hint: "Lower is better", linear: { max: 1.5 * MIB, ticks: [[0, "0"], [0.5 * MIB, "0.5 MiB"], [MIB, "1 MiB"], [1.5 * MIB, "1.5 MiB"]] }, unit: "bytes", min: 1e4, max: 1e8, ticks: [[1e4, "10 KB"], [1e5, "100 KB"], [1e6, "1 MB"], [1e7, "10 MB"], [1e8, "100 MB"]] },
			{ key: "start", title: "Time to first response", hint: "Lower is better", linear: { max: 1e4, ticks: [[0, "0"], [2e3, "2 ms"], [4e3, "4 ms"], [6e3, "6 ms"], [8e3, "8 ms"], [1e4, "10 ms"]] }, unit: "µs", min: 10, max: 1e7, ticks: [[10, "10 µs"], [100, "100 µs"], [1e3, "1 ms"], [1e4, "10 ms"], [1e5, "100 ms"], [1e6, "1 s"], [1e7, "10 s"]] },
			{ key: "toolCall", title: "Tool call round trip", hint: "Lower is better", linear: { max: 150, ticks: [[0, "0"], [50, "50 µs"], [100, "100 µs"], [150, "150 µs"]] }, unit: "µs", min: 0.1, max: 1e3, ticks: [[0.1, "0.1 µs"], [1, "1 µs"], [10, "10 µs"], [100, "100 µs"], [1e3, "1 ms"]] },
		],
		// Single-chart metrics; the combined image keeps the three panels above.
		extraPanels: [
			{ key: "density", title: "Instances per GiB", hint: "Higher is better", linear: { max: 5000, ticks: [[0, "0"], [1000, "1k"], [2000, "2k"], [3000, "3k"], [4000, "4k"], [5000, "5k"]] }, unit: "count", min: 10, max: 1e5, ticks: [[10, "10"], [100, "100"], [1e3, "1k"], [1e4, "10k"], [1e5, "100k"]] },
			{ key: "compute", title: "Parse and aggregate 3 MB of JSON", hint: "Lower is better", linear: { max: 300, ticks: [[0, "0"], [50, "50 ms"], [100, "100 ms"], [150, "150 ms"], [200, "200 ms"], [250, "250 ms"], [300, "300 ms"]] }, unit: "ms", min: 1, max: 1e3, ticks: [[1, "1 ms"], [10, "10 ms"], [100, "100 ms"], [1e3, "1 s"]] },
		],
		columns,
	};
}

const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".js": "text/javascript" };

/** Serves charts/ on a loopback port; the pages fetch their data and logos over HTTP. */
function serveCharts() {
	const server = http.createServer((request, response) => {
		const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
		const file = path.normalize(path.join(CHARTS, pathname));
		if (!file.startsWith(CHARTS) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
		fs.createReadStream(file).pipe(response);
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function chromiumBinary() {
	for (const candidate of [process.env.CHROMIUM, "chromium", "chromium-browser", "google-chrome"]) {
		if (candidate && spawnSync("sh", ["-c", `command -v "${candidate}"`]).status === 0) return candidate;
	}
	throw new Error("no Chromium found; set CHROMIUM");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts headless Chromium with a throwaway profile and connects to its first page target. */
async function startBrowser() {
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), "chart-render-"));
	const chrome = spawn(chromiumBinary(), [
		"--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
		`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--window-size=1400,1000", "about:blank",
	], { stdio: "ignore", detached: true });
	let port = null;
	for (let attempt = 0; attempt < 100 && port === null; attempt++) {
		try {
			port = Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
		} catch {
			await sleep(100);
		}
	}
	if (!port) throw new Error("Chromium never opened its DevTools port");
	let socketUrl = null;
	for (let attempt = 0; attempt < 80 && socketUrl === null; attempt++) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			socketUrl = targets.find((target) => target.type === "page")?.webSocketDebuggerUrl ?? null;
		} catch {}
		if (socketUrl === null) await sleep(150);
	}
	if (socketUrl === null) throw new Error("Chromium has no page target");

	const socket = new WebSocket(socketUrl);
	await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
	let nextId = 0;
	const waiting = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.id && waiting.has(message.id)) {
			waiting.get(message.id)(message);
			waiting.delete(message.id);
		}
	});
	const send = (method, params = {}) => new Promise((resolve) => {
		const id = ++nextId;
		waiting.set(id, resolve);
		socket.send(JSON.stringify({ id, method, params }));
	});
	// Chromium runs in its own process group, so one signal stops the browser and its helpers.
	// The helpers can still flush files into the profile for a moment after the browser exits,
	// so removing the profile is retried for up to ten seconds.
	const close = async () => {
		socket.close();
		const exited = chrome.exitCode === null && chrome.signalCode === null ? new Promise((resolve) => chrome.once("exit", resolve)) : null;
		try {
			process.kill(-chrome.pid, "SIGTERM");
		} catch {}
		await exited;
		for (let attempt = 0; ; attempt++) {
			try {
				fs.rmSync(profile, { recursive: true, force: true });
				return;
			} catch (error) {
				if (attempt >= 50) throw error;
				await sleep(200);
			}
		}
	};
	return { send, close };
}

/** Reads a PNG's width and height from its header. */
function pngSize(file) {
	const header = fs.readFileSync(file).subarray(16, 24);
	return [header.readUInt32BE(0), header.readUInt32BE(4)];
}

/** Renders every figure on one page and returns a layout report per image. */
async function renderPage(browser, url, { scale, width }) {
	const { send } = browser;
	const evaluate = async (expression) => {
		const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
		return reply.result?.result?.value;
	};
	await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: scale, mobile: false });
	await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
	await send("Page.navigate", { url });
	let ready = false;
	for (let attempt = 0; attempt < 200 && !ready; attempt++) {
		ready = await evaluate("document.body?.dataset.ready === '1'");
		if (!ready) await sleep(100);
	}
	if (!ready) throw new Error(`${url} never finished rendering`);

	const figures = await evaluate(`(() => [...document.querySelectorAll('figure.tweet')].map((figure) => {
		const box = figure.getBoundingClientRect();
		const parts = [...figure.querySelectorAll('.value, .tick, .name, .label, h1, h2, .legend')].map((part) => part.getBoundingClientRect());
		return {
			file: figure.dataset.file,
			x: box.left + scrollX,
			y: box.top + scrollY,
			width: box.width,
			height: box.height,
			rightOverflowPx: Math.round(Math.max(...parts.map((part) => part.right)) - box.right),
			bottomOverflowPx: Math.round(Math.max(...parts.map((part) => part.bottom)) - box.bottom),
			missingLogos: [...figure.querySelectorAll('[data-missing-logo]')].map((badge) => badge.dataset.missingLogo),
		};
	}))()`);

	const reports = [];
	for (const figure of figures) {
		const shot = await send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			clip: { x: figure.x, y: figure.y, width: figure.width, height: figure.height, scale: 1 },
		});
		const target = path.join(CHARTS, figure.file);
		fs.writeFileSync(target, Buffer.from(shot.result.data, "base64"));
		const [pixelsWide, pixelsHigh] = pngSize(target);
		reports.push({ file: figure.file, size: `${pixelsWide}x${pixelsHigh}`, rightOverflowPx: figure.rightOverflowPx, bottomOverflowPx: figure.bottomOverflowPx, missingLogos: figure.missingLogos });
	}
	return reports;
}

const data = buildChartData();
fs.writeFileSync(path.join(CHARTS, "src/combined.json"), `${JSON.stringify(data, null, 2)}\n`);

const server = await serveCharts();
const browser = await startBrowser();
const problems = [];
try {
	for (const job of JOBS) {
		const url = `http://127.0.0.1:${server.address().port}/src/${job.page}`;
		for (const report of await renderPage(browser, url, job)) {
			console.error(`[charts] ${report.file} ${report.size}`);
			if (report.missingLogos.length > 0) problems.push(`${report.file}: no logo for ${report.missingLogos.join(", ")}`);
			if (report.rightOverflowPx > 0 || report.bottomOverflowPx > 0) problems.push(`${report.file}: content overflows the card by ${report.rightOverflowPx} px right, ${report.bottomOverflowPx} px down`);
		}
	}
} finally {
	await browser.close();
	server.close();
}
for (const problem of problems) console.error(`[charts] warning: ${problem}`);
