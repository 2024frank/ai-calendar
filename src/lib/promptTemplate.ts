/**
 * Instructions are a template. Whatever is typed for a source can refer to the
 * source's own details with {placeholders}, and the links a source is given are
 * appended to the instructions automatically, so the agent is always told which
 * pages it is working with without anyone retyping them.
 */
export type PromptVars = {
  source_name: string;
  urls: string[];
  today: string;
  timezone: string;
  org_name?: string | null;
  org_website?: string | null;
  contact_email?: string | null;
  phone?: string | null;
};

/** Placeholders an author may use in a source's instructions. */
export const PLACEHOLDERS = [
  "source_name",
  "url",
  "urls",
  "today",
  "timezone",
  "org_name",
  "org_website",
  "contact_email",
  "phone",
] as const;

function valueFor(name: string, v: PromptVars): string | null {
  switch (name) {
    case "source_name":
      return v.source_name;
    case "url":
      return v.urls[0] ?? "";
    case "urls":
      return v.urls.join("\n");
    case "today":
      return v.today;
    case "timezone":
      return v.timezone;
    case "org_name":
      return v.org_name ?? "";
    case "org_website":
      return v.org_website ?? "";
    case "contact_email":
      return v.contact_email ?? "";
    case "phone":
      return v.phone ?? "";
    default:
      return null;
  }
}

/**
 * Replace {placeholder} with its value. An unknown {word} is left exactly as
 * typed, so ordinary prose using braces is never mangled.
 */
export function fillTemplate(template: string, vars: PromptVars): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = valueFor(name, vars);
    return value === null ? whole : value;
  });
}

/**
 * The instruction block for a source: its links first, then whatever special
 * instructions were written, with placeholders filled in.
 */
export function buildSourceInstructions(
  special: string | null | undefined,
  vars: PromptVars,
): string {
  const lines: string[] = [];

  lines.push(`SOURCE: ${vars.source_name}`);
  if (vars.urls.length === 1) {
    lines.push(`LINK: ${vars.urls[0]}`);
  } else if (vars.urls.length > 1) {
    lines.push(`LINKS (this source publishes across all of these):`);
    for (const u of vars.urls) lines.push(`  ${u}`);
  }

  const filled = (special ?? "").trim();
  if (filled) {
    lines.push("");
    lines.push("SPECIAL INSTRUCTIONS FOR THIS SOURCE (honor these):");
    lines.push(fillTemplate(filled, vars));
  }

  return lines.join("\n");
}
