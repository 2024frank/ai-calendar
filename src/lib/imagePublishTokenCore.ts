import { createHash, createHmac, timingSafeEqual } from "crypto";

export function createImagePublishToken(
  eventId: number,
  imageData: string,
  secret: string,
): string {
  const imageDigest = createHash("sha256").update(imageData).digest("hex");
  return createHmac("sha256", secret)
    .update(`publish-image:v1:${eventId}:${imageDigest}`)
    .digest("hex");
}

export function verifyImagePublishTokenWithSecret(
  eventId: number,
  imageData: string,
  token: string | null,
  secret: string,
): boolean {
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = Buffer.from(createImagePublishToken(eventId, imageData, secret), "hex");
  const supplied = Buffer.from(token, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
