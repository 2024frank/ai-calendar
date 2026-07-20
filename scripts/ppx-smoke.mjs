import { config } from "dotenv";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const key = process.env.PERPLEXITY_API_KEY;
if (!key) { console.log("NO KEY"); process.exit(1); }
const res = await fetch("https://api.perplexity.ai/v1/agent", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({
    input: "Reply with the single word: ready",
    models: ["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-5", "openai/gpt-5.6-sol"],
    max_output_tokens: 64,
  }),
});
const text = await res.text();
console.log("HTTP", res.status);
console.log(text.slice(0, 700));
