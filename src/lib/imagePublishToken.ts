import "server-only";
import {
  createImagePublishToken,
  verifyImagePublishTokenWithSecret,
} from "./imagePublishTokenCore";

function signingSecret(): string {
  const secret = process.env.AGENT_INGEST_SECRET;
  if (!secret) throw new Error("AGENT_INGEST_SECRET is not set");
  return secret;
}

/** Grants the publishing destination access to this exact stored image. */
export function imagePublishToken(eventId: number, imageData: string): string {
  return createImagePublishToken(eventId, imageData, signingSecret());
}

export function verifyImagePublishToken(
  eventId: number,
  imageData: string,
  token: string | null,
): boolean {
  try {
    return verifyImagePublishTokenWithSecret(eventId, imageData, token, signingSecret());
  } catch {
    return false;
  }
}
