import "server-only";

/**
 * The one place this app talks to a language model.
 *
 * Perplexity's Agent API is the provider. Two things it gives us that a plain
 * model call does not:
 *   - fetch_url: it retrieves a page itself, so sources that block our server
 *     (403) are readable without us running a scraper.
 *   - a fallback chain: if the first model is unavailable or out of quota the
 *     next one takes over, instead of the whole run dying.
 */
import { toPortableSchema } from "./jsonSchema";

const AGENT_URL = "https://api.perplexity.ai/v1/agent";

/**
 * Best-first. Quality matters more than cost here: a missed or malformed event
 * costs a person's time in review. Later entries only run if an earlier one
 * cannot serve the request.
 */
export const MODEL_CHAIN = [
  "anthropic/claude-opus-4-8",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.6-sol",
];

/**
 * If a model in the chain is ever retired or renamed, the API rejects the whole
 * request at validation (it does not skip the bad entry). Rather than have every
 * run fail, hand the request to Perplexity's own selection instead.
 */
const FALLBACK_PRESET = "high";

function isUnsupportedModelError(message: string): boolean {
  return /model .* is not supported|models\[\d+\]/i.test(message);
}

/** The models this key may use, straight from the API. */
export async function listModels(): Promise<string[]> {
  const res = await fetch("https://api.perplexity.ai/v1/models", {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data ?? []).map((m) => String(m.id)).filter(Boolean);
}

export type LlmUsage = { input: number; output: number; costUsd: number | null };

export type LlmResult = {
  text: string;
  model: string | null;
  usage: LlmUsage;
  /** Pages the model fetched itself, when fetch_url was enabled. */
  fetched: { url: string; title: string | null; chars: number }[];
};

type JsonSchema = Record<string, unknown>;


function apiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) throw new Error("PERPLEXITY_API_KEY is not set");
  return key;
}

/** Pull the assistant text and any fetched-page results out of the response. */
function readResponse(body: Record<string, unknown>): Omit<LlmResult, "usage"> {
  const output = Array.isArray(body.output) ? (body.output as Record<string, unknown>[]) : [];
  const texts: string[] = [];
  const fetched: LlmResult["fetched"] = [];

  for (const item of output) {
    if (item.type === "message") {
      const content = Array.isArray(item.content) ? (item.content as Record<string, unknown>[]) : [];
      for (const part of content) {
        if (typeof part.text === "string") texts.push(part.text);
      }
    }
    if (item.type === "fetch_url_results") {
      const contents = Array.isArray(item.contents) ? (item.contents as Record<string, unknown>[]) : [];
      for (const c of contents) {
        const snippet = String(c.snippet ?? c.content ?? "");
        fetched.push({
          url: String(c.url ?? ""),
          title: (c.title as string) ?? null,
          chars: snippet.length,
        });
      }
    }
  }

  // Some responses also expose the aggregated text directly.
  const text = texts.join("\n").trim() || String(body.output_text ?? "").trim();
  return { text, model: (body.model as string) ?? null, fetched };
}

export type LlmCall = {
  prompt: string;
  /** System-level guidance, kept separate from the untrusted page content. */
  instructions?: string;
  schema?: JsonSchema;
  schemaName?: string;
  maxTokens?: number;
  /** Let the model retrieve pages itself (for sources that block our server). */
  fetchUrls?: number;
  /** How many tool/reasoning steps the agent may take. */
  maxSteps?: number;
};

export async function llmComplete(call: LlmCall): Promise<LlmResult> {
  const body: Record<string, unknown> = {
    input: call.prompt,
    models: MODEL_CHAIN,
    // Required for anthropic/* models, and a sane ceiling for the rest.
    max_output_tokens: call.maxTokens ?? 16000,
  };
  if (call.instructions) body.instructions = call.instructions;
  if (call.maxSteps) body.max_steps = call.maxSteps;
  if (call.fetchUrls) body.tools = [{ type: "fetch_url", max_urls: call.fetchUrls }];
  if (call.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: call.schemaName ?? "result",
        schema: toPortableSchema(call.schema),
      },
    };
  }

  const res = await fetch(AGENT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    // A first request with a new schema can take 10-30s just to compile it, and
    // a fetch_url run walks real pages. Nothing here is cut short.
    signal: AbortSignal.timeout(600_000),
  });

  let raw = await res.text();
  if (!res.ok) {
    // A retired or renamed model fails validation for the whole request. Retry
    // once letting Perplexity pick, so a model going away is not an outage.
    if (res.status === 400 && isUnsupportedModelError(raw)) {
      const { models: _dropped, ...rest } = body as Record<string, unknown>;
      const retry = await fetch(AGENT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...rest, preset: FALLBACK_PRESET }),
        signal: AbortSignal.timeout(600_000),
      });
      const retryRaw = await retry.text();
      if (!retry.ok) {
        throw new Error(`Perplexity ${retry.status}: ${retryRaw.slice(0, 400)}`);
      }
      raw = retryRaw;
    } else {
      throw new Error(`Perplexity ${res.status}: ${raw.slice(0, 400)}`);
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Perplexity returned a response that was not JSON.");
  }

  const usageRaw = (parsed.usage ?? {}) as Record<string, unknown>;
  const usage: LlmUsage = {
    input: Number(usageRaw.input_tokens ?? usageRaw.prompt_tokens ?? 0),
    output: Number(usageRaw.output_tokens ?? usageRaw.completion_tokens ?? 0),
    costUsd:
      usageRaw.cost != null
        ? Number((usageRaw.cost as Record<string, unknown>).total_cost ?? usageRaw.cost)
        : null,
  };

  return { ...readResponse(parsed), usage };
}
