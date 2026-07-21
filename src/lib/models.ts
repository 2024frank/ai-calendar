import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_MODEL, MODELS } from "./modelList";

const MODEL_KEY = "extraction_model";

/** The model the admin has chosen for all sources (defaults to Opus). */
export async function activeModel(): Promise<string> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, MODEL_KEY)).limit(1);
  const v = row?.value?.trim();
  return v && MODELS.some((m) => m.id === v) ? v : DEFAULT_MODEL;
}

export async function setActiveModel(id: string): Promise<void> {
  if (!MODELS.some((m) => m.id === id)) throw new Error("Unknown model");
  await db
    .insert(appSettings)
    .values({ key: MODEL_KEY, value: id })
    .onDuplicateKeyUpdate({ set: { value: id } });
}

/**
 * The models chain to send: the chosen model first, then the others as
 * fallbacks so a single model being unavailable never fails a run.
 */
export async function modelChain(): Promise<string[]> {
  const chosen = await activeModel();
  const rest = MODELS.map((m) => m.id).filter((id) => id !== chosen);
  return [chosen, ...rest];
}
