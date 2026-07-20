import { config } from "dotenv";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const key = process.env.PERPLEXITY_API_KEY;
for (const path of ["/v1/models", "/models", "/v1/model"]) {
  const res = await fetch("https://api.perplexity.ai" + path, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const body = await res.text();
  console.log(path, "HTTP", res.status, body.slice(0, 200).replace(/\n/g, " "));
  if (res.ok) {
    try {
      const j = JSON.parse(body);
      const list = Array.isArray(j) ? j : (j.data ?? j.models ?? []);
      console.log("  count:", list.length);
      for (const m of list.slice(0, 40)) console.log("   ", m.id ?? m.name ?? JSON.stringify(m).slice(0, 60));
    } catch {}
    break;
  }
}
