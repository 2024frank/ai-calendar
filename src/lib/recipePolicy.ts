import { isPublicHttpUrl } from "./publicUrl";

/**
 * Discovery output is model-authored data. Keep only one canonical public URL,
 * never raw whitespace/control characters that could become prompt lines.
 */
export function canonicalRecipeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 4_096 || /\s|[\u0000-\u001f\u007f]/u.test(value)) {
    return null;
  }
  if (!isPublicHttpUrl(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}
