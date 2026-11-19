// Renders each 1200x900 figure on the tweet chart page to a 2400x1800 PNG and reports layout problems.
//
// Usage: node render_tweets.mjs <charts page URL> <output dir>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [pageUrl, outDir, scaleArgument, widthArgument] = process.argv.slice(2);
const scale = Number(scaleArgument ?? 2);
const viewportWidth = Number(widthArgument ?? 1400);
const port = 9361;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn("chromium", [
	"--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
	`--remote-debugging-port=${port}`, "--window-size=1400,1000", "about:blank",
], { stdio: "ignore" });

async function pageSocketUrl() {
	for (let attempt = 0; attempt < 80; attempt++) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			const page = (await response.json()).find((target) => target.type === "page");
			if (page) return page.webSocketDebuggerUrl;
		} catch {}
		await sleep(150);
	}
	throw new Error("devtools endpoint never came up");
}

const socket = new WebSocket(await pageSocketUrl());
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
const evaluate = async (expression) => {
	const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
	return reply.result?.result?.value;
};

try {
	await send("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: 1000, deviceScaleFactor: scale, mobile: false });
	await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
	await send("Page.navigate", { url: `${pageUrl}${pageUrl.includes("?") ? "&" : "?"}t=${Date.now()}` });
	for (let attempt = 0; attempt < 200; attempt++) {
		if (await evaluate("document.body?.dataset.ready === '1'")) break;
		await sleep(100);
	}

	const figures = await evaluate(`(() => [...document.querySelectorAll('figure.tweet')].map((figure) => {
		const box = figure.getBoundingClientRect();
		const noteElement = figure.querySelector('.note');
		const note = noteElement ? noteElement.getBoundingClientRect() : { top: box.bottom, bottom: box.bottom };
		const plotParts = [...figure.querySelectorAll('.plot > *')].map((part) => part.getBoundingClientRect());
		const lowestPart = Math.max(...plotParts.map((part) => part.bottom));
		const highestValue = Math.min(...[...figure.querySelectorAll('.value')].map((part) => part.getBoundingClientRect().top));
		const panelTitleBottom = Math.max(...[...figure.querySelectorAll('.panel h2')].map((part) => part.getBoundingClientRect().bottom), -Infinity);
		const lowestPlotPart = Math.max(...plotParts.map((part) => part.bottom));
		const rightmost = Math.max(...[...figure.querySelectorAll('.value, .tick, .note, .sub, h2')].map((part) => part.getBoundingClientRect().right));
		return {
			id: figure.id,
			file: figure.dataset.file,
			x: box.left + scrollX,
			y: box.top + scrollY,
			width: box.width,
			height: box.height,
			plotOverlapsNotePx: Math.round(lowestPlotPart - note.top),
			noteBottomInsidePx: Math.round(box.bottom - note.bottom),
			rightOverflowPx: Math.round(rightmost - box.right),
			lowestPartInsidePx: Math.round(box.bottom - lowestPart),
			valuesClearOfPanelTitlesPx: Math.round(highestValue - panelTitleBottom),
			monograms: [...figure.querySelectorAll('[data-missing-logo]')].map((badge) => badge.dataset.missingLogo),
			logoFiles: [...new Set([...figure.querySelectorAll('img.logo')].map((image) => image.dataset.slug + '=' + image.dataset.file))],
		};
	}))()`);

	fs.mkdirSync(outDir, { recursive: true });
	for (const figure of figures) {
		const shot = await send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			clip: { x: figure.x, y: figure.y, width: figure.width, height: figure.height, scale: 1 },
		});
		const target = path.join(outDir, figure.file);
		fs.writeFileSync(target, Buffer.from(shot.result.data, "base64"));
		const { x, y, ...report } = figure;
		console.log(JSON.stringify({ ...report, bytes: fs.statSync(target).size }));
	}
} finally {
	socket.close();
	chrome.kill();
}
