/**
 * Client-safe model catalog: the models an admin can pick, with reference
 * prices (US dollars per million tokens, provider list rates; the Agent API
 * passes them through with no markup). Live per-run cost is measured exactly
 * from what the API bills, so these are for comparing before you switch.
 */
export type ModelChoice = {
  id: string;
  label: string;
  inPerM: number;
  outPerM: number;
  note: string;
};

export const MODELS: ModelChoice[] = [
  { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8", inPerM: 15, outPerM: 75, note: "Most capable, best on messy sites. Default." },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", inPerM: 3, outPerM: 15, note: "Strong and about 5x cheaper than Opus." },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", inPerM: 1, outPerM: 5, note: "Fastest and cheapest Claude." },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", inPerM: 2, outPerM: 12, note: "Google's frontier model." },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol", inPerM: 5, outPerM: 20, note: "OpenAI frontier model." },
];

export const DEFAULT_MODEL = "anthropic/claude-opus-4-8";

export function modelLabel(id: string | null): string {
  return MODELS.find((m) => m.id === id)?.label ?? id ?? "unknown";
}
