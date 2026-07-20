import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const url = process.argv[2];
const messages = [{ role: "user", content: `Fetch ${url} and return the visible text of that events listing exactly as published. Include every event's date, time, title and location. Whenever an event has its own picture, put that picture's full URL inline as [IMAGE: <url>]. Return page content only.` }];
for (let hop = 0; hop < 6; hop++) {
  const res = await c.messages.create({
    model: "claude-opus-4-8", max_tokens: 8000,
    tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 }],
    messages,
  });
  if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
  const text = res.content.find(b => b.type === "text")?.text ?? "";
  console.log(`stop=${res.stop_reason} chars=${text.length}`);
  console.log(text.slice(0, 700));
  break;
}
