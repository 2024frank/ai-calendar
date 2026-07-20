/**
 * Schema shaping for providers with stricter validators than ours.
 *
 * Perplexity rejects union types written as `type: ["string","null"]`; the form
 * its documentation demonstrates is `anyOf`. Converting here keeps the contract
 * in src/lib/contract.ts readable and provider-neutral.
 */
export function toPortableSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toPortableSchema);
  if (!node || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === "type" && Array.isArray(value)) {
      out.anyOf = value.map((t) => ({ type: t }));
      continue;
    }
    out[key] = toPortableSchema(value);
  }
  return out;
}
