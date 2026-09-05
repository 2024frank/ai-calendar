import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Synthetic component preview only. No app server, credentials, or production API.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.UI_PREVIEW_PORT || 4317);
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["tests/fixtures/ui-preview.tsx"],
  bundle: true,
  write: false,
  outfile: "ui-preview.js",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    "next/image": resolve(root, "tests/fixtures/next-image.tsx"),
    "next/link": resolve(root, "tests/fixtures/next-link.tsx"),
    "next/navigation": resolve(root, "tests/fixtures/next-navigation.ts"),
  },
});
const assets = new Map(bundle.outputFiles.map((file) => [file.path.endsWith(".css") ? "/ui-preview.css" : "/ui-preview.js", file.contents]));
// Reuse Next's self-hosted production font when a local build is available.
let fontStyles = "";
try {
  const chunks = resolve(root, ".next/static/chunks");
  for (const filename of (await readdir(chunks)).filter((name) => name.endsWith(".css"))) {
    const css = await readFile(resolve(chunks, filename), "utf8");
    const faces = (css.match(/@font-face\{[^}]*\}/g) || []).filter((face) => /font-family:["']?Plus Jakarta Sans/.test(face));
    for (const face of faces) {
      for (const match of face.matchAll(/\.\.\/media\/([\w.-]+\.woff2?)/g)) {
        assets.set(`/__fixture/fonts/${match[1]}`, await readFile(resolve(root, ".next/static/media", match[1])));
      }
    }
    fontStyles += faces.join("").replaceAll("../media/", "/__fixture/fonts/");
  }
} catch {
  console.log("Production font unavailable. Run npm run build first for matching typography; using the system sans fallback.");
}
if (fontStyles) assets.set("/__fixture/fonts.css", Buffer.from(`${fontStyles}:root{--font-sans:"Plus Jakarta Sans","Plus Jakarta Sans Fallback"}`));
let activeId = 1;
const pending = () => activeId === 1 ? 12 : 3;

function json(response, data, status = 200) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(data));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    if (assets.has(url.pathname)) {
      const contentType = url.pathname.endsWith(".css") ? "text/css" : /\.woff2?$/.test(url.pathname) ? "font/woff2" : "text/javascript";
      response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
      response.end(assets.get(url.pathname));
      return;
    }
    if (["/brand/communityhub-mark.png", "/brand/communityhub-wordmark.png"].includes(url.pathname)) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(await readFile(resolve(root, "public", url.pathname.slice(1))));
      return;
    }
    if (url.pathname === "/__fixture/state") return json(response, { activeId, pending: pending() });
    if (url.pathname === "/api/pending-count") return json(response, { count: pending() });
    if (url.pathname === "/api/events/900/image.jpg") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(await readFile(resolve(root, "public/brand/communityhub-mark.png")));
      return;
    }
    if (url.pathname === "/api/evaluations/901") return json(response, JSON.parse(await readFile(resolve(root, "tests/fixtures/pilot-evaluation.json"), "utf8")));
    if (url.pathname === "/api/evaluations" && request.method === "POST") return json(response, { error: "Synthetic preview only: no evidence was retained. Real retention is tested separately against isolated SQL." }, 409);
    if (url.pathname === "/api/events/900/request-correction" && request.method === "POST") return json(response, { error: "Synthetic correction failure. No model was called and no event was changed." }, 503);
    if (url.pathname === "/api/events/900/update-published" && request.method === "POST") return json(response, { ok: true, message: "Synthetic update confirmed. No CommunityHub request was made." });
    if (url.pathname === "/api/events/900/resolve-proposal" && request.method === "POST") return json(response, { ok: true, eventId: 900, originalEventId: 899, proposalResolvedAt: "2026-09-05T15:00:00Z", alreadyResolved: false });
    if (url.pathname === "/api/events/900" && request.method === "PATCH") return json(response, { changed: 1 });
    if (url.pathname === "/api/communities/switch" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const choice = JSON.parse(body).communityId;
      if (choice !== 1 && choice !== 2) return json(response, { error: "Unknown fixture community" }, 400);
      activeId = choice;
      return json(response, { ok: true });
    }
    const run = url.pathname.match(/^\/api\/runs\/(\d+)\/events$/);
    if (run) {
      const id = Number(run[1]);
      if (id === 3) return json(response, { error: "Synthetic network outage" }, 503);
      if (id === 4) return json(response, { error: "Synthetic expired session" }, 401);
      if (id === 6) return json(response, { error: "Synthetic missing run" }, 404);
      const finished = id === 1;
      const after = Number(url.searchParams.get("after") || 0);
      const recorded = [
        { id: 1, seq: 1, ts: "2026-09-05T14:00:00Z", kind: "run_started", label: "Started fixture extraction", data: null },
        { id: 2, seq: 2, ts: "2026-09-05T14:00:04Z", kind: "fetch_result", label: "Read the sample community event page", data: null },
        ...(finished ? [{ id: 3, seq: 3, ts: "2026-09-05T14:00:07Z", kind: "run_finished", label: "Collected 3 sample events for review", data: null }] : []),
      ];
      return json(response, {
        events: recorded.filter((event) => event.id > after),
        nextAfter: Math.max(after, recorded.at(-1).id),
        status: finished ? "completed" : "running",
        phase: id === 5 ? "awaiting_callback" : id === 7 ? "queued" : null,
        terminal: finished,
        tokens: { prompt: 1200, completion: 350 },
      });
    }
    if (url.pathname.startsWith("/api/")) return json(response, { error: "Only synthetic preview endpoints exist here" }, 404);
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI Calendar UI test fixture</title><link rel="stylesheet" href="/ui-preview.css">${fontStyles ? '<link rel="stylesheet" href="/__fixture/fonts.css">' : ""}</head><body><div id="root"></div><script src="/ui-preview.js"></script></body></html>`);
  } catch (error) {
    console.error("UI preview request failed:", error.message);
    if (!response.headersSent) json(response, { error: "Fixture error" }, 500);
    else response.end();
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`UI test fixture: http://127.0.0.1:${port}/dashboard`);
  console.log("Synthetic data only. Real components, no database or production requests. Stop with Ctrl+C.");
});
