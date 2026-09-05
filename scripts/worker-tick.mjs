#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HELP = `Run one authenticated AI Calendar worker tick.

Usage: npm run worker:tick -- [--url URL] [--limit 1..5] [--timeout-ms 1..300000]

Required environment:
  AI_CALENDAR_WORKER_URL  Full /api/internal/jobs URL (or use --url).
  WORKER_SECRET          Worker bearer secret. Never pass it as a CLI argument.

Defaults: limit 1, timeout 290000ms. HTTPS is required except on loopback.
This command does not load an env file, install a schedule, or retry delivery.
Use an external scheduler to run it repeatedly. An interrupted request may
still be executing on the server; let the server recover stale job leases.
`;

function integer(value, min, max, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return number;
}

/** @param {string[]} args @param {Record<string, string | undefined>} env */
export function workerTickOptions(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  let endpoint = env.AI_CALENDAR_WORKER_URL;
  let limit = 1;
  let timeoutMs = 290000;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!["--url", "--limit", "--timeout-ms"].includes(flag)) throw new Error("Unknown option. Use --help for usage.");
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing option value. Use --help for usage.");
    if (flag === "--url") endpoint = value;
    if (flag === "--limit") limit = integer(value, 1, 5, "Limit");
    if (flag === "--timeout-ms") timeoutMs = integer(value, 1, 300000, "Timeout");
  }
  if (!endpoint) throw new Error("Set AI_CALENDAR_WORKER_URL or use --url explicitly.");
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("Worker URL is invalid."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.pathname !== "/api/internal/jobs" || url.search || url.hash) {
    throw new Error("Worker URL must be an HTTPS /api/internal/jobs endpoint without credentials, query, or fragment. HTTP is allowed only on loopback.");
  }
  const secret = env.WORKER_SECRET;
  if (typeof secret !== "string" || !secret || /[^\x21-\x7e]/.test(secret)) throw new Error("Set WORKER_SECRET to a nonempty secret without whitespace or control characters.");
  url.searchParams.set("limit", String(limit));
  return { url: url.href, secret, timeoutMs };
}

async function boundedBody(response) {
  const maxBytes = 65536;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Worker returned an unexpected response.");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("Worker response was too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Worker returned an unexpected response."); }
}

/** @param {*} options @param {(url: string, init: RequestInit) => Promise<Response>} fetchImpl */
export async function workerTick(options, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(options.url, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${options.secret}`, accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    throw new Error("Worker request failed or timed out; delivery may be incomplete.");
  }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* Never echo upstream error content. */ }
    throw new Error(`Worker returned HTTP ${response.status}.`);
  }
  let body;
  try { body = await boundedBody(response); }
  catch (error) {
    if (error instanceof Error && ["Worker response was too large.", "Worker returned an unexpected response."].includes(error.message)) throw error;
    throw new Error("Worker request failed or timed out; delivery may be incomplete.");
  }
  const counters = { recovered: body?.recovered, considered: body?.drained?.considered, succeeded: body?.drained?.succeeded, failed: body?.drained?.failed, remaining: body?.remaining };
  if (body?.ok !== true || Object.values(counters).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Worker returned an unexpected response.");
  return { ok: true, ...counters };
}

async function main() {
  try {
    const options = workerTickOptions();
    if (options.help) process.stdout.write(HELP);
    else process.stdout.write(`${JSON.stringify(await workerTick(options))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
