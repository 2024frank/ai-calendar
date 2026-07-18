import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
config({ path: new URL("../.env.local", import.meta.url) });
const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const targets = [
  ["Oberlin Public Library", "https://www.oberlinlibrary.org/"],
  ["City Fresh", "https://cityfresh.org/"],
  ["Northern Ohio Youth Orchestra", "https://www.noyo.org/"],
  ["Oberlin Business Partnership", "https://www.oberlinbusinesspartnership.com/"],
];
for (const [name, url] of targets) {
  const messages = [{ role: "user", content: `Fetch ${url} (and its contact page if needed) and report ONLY this organization's official public contact email address and phone number, exactly as published. Format your answer as two lines:\nEMAIL: <address or NONE>\nPHONE: <number or NONE>\nDo not guess or infer. If the site does not publish one, say NONE.` }];
  let out = "";
  for (let hop = 0; hop < 5; hop++) {
    const res = await c.messages.create({
      model: "claude-opus-4-8", max_tokens: 4000,
      tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 }],
      messages,
    });
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    out = res.content.filter(b => b.type === "text").map(b => b.text).join("\n");
    break;
  }
  const email = /EMAIL:\s*(\S+@\S+)/i.exec(out)?.[1] ?? "NONE";
  const phone = /PHONE:\s*([\d()+\-.\s]{7,})/i.exec(out)?.[1]?.trim() ?? "NONE";
  console.log(`${name}\n   email: ${email}\n   phone: ${phone}`);
}
