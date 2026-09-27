/**
 * Some image CDNs (AWS Serverless Image Handler, e.g. images.locable.com) put
 * a base64 JSON request in the path naming the S3 bucket and key they resize
 * from. The CDN answers servers with a Cloudflare bot challenge, but the bucket
 * itself serves the original publicly, so fetch the original from S3 instead.
 */
export function s3OriginalFor(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segment = parsed.pathname.split("/").filter(Boolean).pop();
  if (!segment || segment.length < 20) return null;
  try {
    const request = JSON.parse(Buffer.from(decodeURIComponent(segment), "base64").toString("utf8")) as {
      bucket?: unknown;
      key?: unknown;
    };
    const { bucket, key } = request;
    if (typeof bucket !== "string" || typeof key !== "string" || !key) return null;
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..")) return null;
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `https://${bucket}.s3.amazonaws.com/${path}`;
  } catch {
    return null;
  }
}
