// Generates the deterministic order dataset and the exact reference result (integer cents).
import crypto from "node:crypto";
import fs from "node:fs";
const SEED = 20261119;
let state = SEED >>> 0;
function next() { // mulberry32
	state = (state + 0x6d2b79f5) >>> 0;
	let t = state;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
const REGIONS = ["us-east", "us-west", "eu-west", "eu-north", "ap-south", "ap-east", "sa-east", "af-south"];
const ITEM_WEIGHTS = [0.45, 0.25, 0.12, 0.08, 0.06, 0.04]; // 1..6 items, skewed to small orders
function itemCount() {
	let r = next();
	for (let k = 0; k < ITEM_WEIGHTS.length; k++) { if (r < ITEM_WEIGHTS[k]) return k + 1; r -= ITEM_WEIGHTS[k]; }
	return ITEM_WEIGHTS.length;
}
const orders = [];
for (let id = 1; id <= 20000; id++) {
	const items = [];
	const n = itemCount();
	for (let i = 0; i < n; i++) {
		let cents = int(101, 9999);
		if (cents % 100 === 0) cents += 1; // never integral, so price is a float in every language
		items.push({ sku: "S" + String(int(0, 999)).padStart(3, "0"), qty: int(1, 5), price: cents / 100 });
	}
	orders.push({ id, customer: "c" + String(int(0, 499)).padStart(3, "0"), region: REGIONS[int(0, 7)], items, ts: 1767225600 + int(0, 365 * 86400 - 1) });
}
const text = JSON.stringify(orders);
fs.writeFileSync(new URL("./data/orders.json", import.meta.url), text);
// Exact reference in integer cents.
const region = {}, customer = {};
let big = 0;
for (const o of orders) {
	if (o.items.length > 3) big++;
	let c = 0;
	for (const it of o.items) c += it.qty * Math.round(it.price * 100);
	region[o.region] = (region[o.region] || 0) + c;
	customer[o.customer] = (customer[o.customer] || 0) + c;
}
const ranked = Object.entries(customer).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
if (ranked[4][1] === ranked[5][1]) throw new Error("tie at rank 5");
const canonical = {
	revenueByRegion: Object.fromEntries(Object.keys(region).sort().map((k) => [k, region[k]])),
	topCustomers: ranked.slice(0, 5),
	ordersWithMoreThan3Items: big,
};
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const meta = { seed: SEED, records: orders.length, bytes: Buffer.byteLength(text), sha256: sha(text), itemWeights: ITEM_WEIGHTS, expected: canonical, expectedChecksum: sha(JSON.stringify(canonical)) };
fs.writeFileSync(new URL("./data/meta.json", import.meta.url), JSON.stringify(meta, null, 2));
console.log(JSON.stringify({ bytes: meta.bytes, sha256: meta.sha256, expectedChecksum: meta.expectedChecksum, big }));
