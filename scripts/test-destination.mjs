import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/** A synthetic, in-memory test double. This module never opens outbound connections. */
export async function startTestDestination({ port = 0, maxRecords = 100, maxBodyBytes = 64 * 1024, maxHistory = 200 } = {}) {
  for (const [name, value, minimum, maximum] of [
    ["port", port, 0, 65535], ["maxRecords", maxRecords, 1, 1000],
    ["maxBodyBytes", maxBodyBytes, 128, 256 * 1024], ["maxHistory", maxHistory, 1, 1000],
  ]) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  }
  const posts = new Map();
  const requests = [];
  let nextId = 1;
  let acceptedRequests = 0;
  let nextAcknowledgment = "numeric";
  let baseUrl = "";
  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    const send = (status, body) => {
      // Close rejected requests so unconsumed request bodies cannot fill memory.
      if (status >= 400) response.setHeader("connection", "close");
      response.writeHead(status).end(JSON.stringify({ synthetic: true, ...body }));
    };
    try {
      if (request.socket.remoteAddress !== "127.0.0.1" || request.headers.host !== new URL(baseUrl).host ||
        (request.headers.origin && request.headers.origin !== baseUrl)) {
        send(403, { error: "Loopback, same-origin requests only." });
        return;
      }
      if (request.method === "GET" && request.url === "/__synthetic__/posts") {
        send(200, { posts: [...posts.values()], requests, acceptedRequests });
        return;
      }
      const creating = request.method === "POST" && request.url === "/api/legacy/calendar/post/submit";
      const match = request.method === "PATCH" && /^\/api\/legacy\/calendar\/post\/([1-9]\d*)\/submit$/.exec(request.url ?? "");
      if (!creating && !match) { send(404, { error: "not found" }); return; }
      const existingId = match ? Number(match[1]) : null;
      if (existingId !== null && (!Number.isSafeInteger(existingId) || !posts.has(existingId))) {
        send(404, { error: "Synthetic post not found." }); return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
        send(415, { error: "Send application/json." }); return;
      }
      if (Number(request.headers["content-length"]) > maxBodyBytes) {
        send(413, { error: "Synthetic payload is too large." }); return;
      }
      const bytes = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let exceeded = false;
        request.on("data", chunk => {
          if (exceeded) return;
          size += chunk.length;
          if (size > maxBodyBytes) {
            exceeded = true;
            chunks.length = 0;
            reject(Object.assign(new Error("Synthetic payload is too large."), { status: 413 }));
          } else chunks.push(chunk);
        });
        request.once("end", () => resolve(Buffer.concat(chunks)));
        request.once("error", reject);
        request.once("aborted", () => reject(new Error("Request aborted.")));
      });
      let incoming;
      try { incoming = JSON.parse(bytes.toString("utf8")); }
      catch { send(400, { error: "Malformed JSON." }); return; }
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
        send(422, { error: "Expected a synthetic post object." }); return;
      }
      const payload = { ...(existingId === null ? {} : posts.get(existingId).payload), ...incoming };
      if (typeof payload.title !== "string" || !/^\[SYNTHETIC TEST\]\s+\S/.test(payload.title)) {
        send(422, { error: "Titles must start with [SYNTHETIC TEST] followed by a test title. Never send real records." }); return;
      }
      if (Buffer.byteLength(JSON.stringify(payload)) > maxBodyBytes) {
        send(413, { error: "Merged synthetic post is too large." }); return;
      }
      if (creating && posts.size >= maxRecords) { send(507, { error: "Synthetic record limit reached; restart to clear memory." }); return; }
      const id = existingId ?? nextId++;
      posts.set(id, { id, synthetic: true, payload });
      acceptedRequests++;
      requests.push({ method: request.method, path: request.url, id });
      if (requests.length > maxHistory) requests.shift();
      const acknowledgment = nextAcknowledgment;
      nextAcknowledgment = "numeric";
      send(creating ? 201 : 200, acknowledgment === "ambiguous" ? { accepted: true } : { id });
    } catch (error) {
      if (!response.headersSent) send(error.status === 413 ? 413 : 400, { error: error.status === 413 ? "Synthetic payload is too large." : "Invalid request." });
    }
  });
  server.maxConnections = 16;
  server.maxRequestsPerSocket = 100;
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.setTimeout(5000, socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(undefined); });
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    /** Test-only fault injection. No HTTP endpoint exposes this control. */
    setNextAcknowledgment: mode => {
      if (mode !== "numeric" && mode !== "ambiguous") throw new Error("Invalid acknowledgment mode.");
      nextAcknowledgment = mode;
    },
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve(undefined));
      server.closeAllConnections();
    }),
  };
}

async function main(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("SYNTHETIC TEST DESTINATION — in-memory only, never forwards requests.\nUsage: node scripts/test-destination.mjs [--port 4319]\nBinds only 127.0.0.1. Titles must start with [SYNTHETIC TEST].\nPOST /api/legacy/calendar/post/submit\nPATCH /api/legacy/calendar/post/:id/submit\nGET /__synthetic__/posts (local inspection)\nRestart clears all synthetic data. Do not configure production destinations to use this receiver.");
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]))) throw new Error("Use --help or --port <0-65535>. Host binding cannot be changed.");
  const receiver = await startTestDestination({ port: args.length ? Number(args[1]) : 4319 });
  console.log(`SYNTHETIC ONLY: ${receiver.baseUrl}\nInspect: ${receiver.baseUrl}/__synthetic__/posts\nData stays in memory until shutdown. No outbound publishing.`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void receiver.close().then(() => { process.exitCode = 0; }); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
