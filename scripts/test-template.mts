import { buildSourceInstructions, fillTemplate } from "../src/lib/promptTemplate";
const vars = {
  source_name: "Oberlin Public Library",
  urls: ["https://oberlin-public-library.locable.com/events/", "https://www.oberlinlibrary.org/calendar"],
  today: "2026-07-19",
  timezone: "America/New_York",
  org_name: "Oberlin Public Library",
  org_website: "https://www.oberlinlibrary.org",
  contact_email: "info@oberlinlibrary.org",
  phone: null,
};
console.log("=== links only, no special instructions ===");
console.log(buildSourceInstructions("", vars));
console.log("\n=== with special instructions using placeholders ===");
console.log(buildSourceInstructions(
  "The sponsor is always {source_name}. Skip anything before {today}. Use {contact_email} when a listing gives none. Costs are shown as {price} on this site.",
  vars,
));
console.log("\n=== unknown placeholder is left alone ===");
console.log(fillTemplate("Keep {price} and {notreal} as typed.", vars));
