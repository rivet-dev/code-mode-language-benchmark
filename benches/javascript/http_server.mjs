// Serves JSON tool calls over loopback HTTP and prints its port, standing in for a host tool server.
// GET /cpu returns this process's CPU usage so the client can count both sides.
import http from "node:http";

const server = http.createServer((request, response) => {
	if (request.url === "/cpu") {
		const reply = JSON.stringify({ cpu: process.cpuUsage() });
		response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(reply) });
		response.end(reply);
		return;
	}

	let body = "";
	request.setEncoding("utf8");
	request.on("data", (chunk) => {
		body += chunk;
	});
	request.on("end", () => {
		const call = JSON.parse(body);
		const reply = JSON.stringify({ id: call.id, ok: true, value: call.args.s.length });
		response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(reply) });
		response.end(reply);
	});
});

server.keepAliveTimeout = 60_000;
server.listen(0, "127.0.0.1", () => {
	process.stdout.write(`${server.address().port}\n`);
});
