import { lookup } from "dns/promises";

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) return ipv4IsPrivate(address);
  const normalized = address.toLowerCase();
  const embedded = normalized.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) return ipv4IsPrivate(embedded[1]);
  const mapped = /^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return ipv4IsPrivate(
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
    );
  }
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe")) return true;
  if (normalized.startsWith("ff")) return true;
  return false;
}

/** Fast reject of unsafe schemes, credentials, and explicit private hosts. */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)
  ) {
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && ipv4IsPrivate(hostname)) return false;
  if (hostname.includes(":") && isPrivateAddress(hostname, 6)) return false;
  return true;
}

/** Validate URL syntax and refuse any private address returned by DNS. */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  if (!isPublicHttpUrl(raw)) throw new Error("blocked_non_public_url");
  const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error("dns_resolution_failed");
  }
  if (!addresses.length) throw new Error("dns_no_records");
  for (const address of addresses) {
    if (isPrivateAddress(address.address, address.family)) {
      throw new Error("blocked_private_ip");
    }
  }
}
