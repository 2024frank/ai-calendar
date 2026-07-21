// What can the Perplexity sandbox actually reach? Direct probe, JSON verdict.
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
const { llmComplete } = await import("../src/lib/llm.ts").catch(() => ({}));
