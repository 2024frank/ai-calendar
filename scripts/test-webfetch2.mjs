import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
config({ path: new URL("../.env.local", import.meta.url) });
const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const url = process.argv[2];
const res = await c.messages.create({
  model: "claude-opus-4-8", max_tokens: 8000,
  tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }],
  messages: [{ role: "user", content: `Fetch ${url} and list every event with its date and title.` }],
});
console.log("stop_reason:", res.stop_reason);
for (const b of res.content) {
  console.log(`--- block: ${b.type}`);
  if (b.type === "text") console.log(b.text.slice(0, 500));
  else console.log(JSON.stringify(b).slice(0, 600));
}
