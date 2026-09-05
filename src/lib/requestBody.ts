export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request_body_too_large");
  }
}

/** Parse JSON while enforcing the limit against bytes actually received. */
export async function readJsonBodyLimited<T>(req: Request, maxBytes: number): Promise<T> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyTooLargeError();
  if (!req.body) return JSON.parse("") as T;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged)) as T;
}

/** An HTTP mutation needs an object, not merely syntactically valid JSON. */
export async function readJsonObjectBody(req: Request, maxBytes: number): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string; status: 400 | 413 }
> {
  try {
    const body = await readJsonBodyLimited<unknown>(req, maxBytes);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, error: "A JSON object is required.", status: 400 };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? { ok: false, error: "Request body is too large.", status: 413 }
      : { ok: false, error: "Invalid JSON.", status: 400 };
  }
}
