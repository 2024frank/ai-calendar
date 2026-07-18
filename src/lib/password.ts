import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/** Format: s1$<salt-hex>$<derived-key-hex> */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(password, salt, 64).toString("hex");
  return `s1$${salt}$${dk}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [version, salt, dk] = stored.split("$");
  if (version !== "s1" || !salt || !dk) return false;
  const calculated = scryptSync(password, salt, 64);
  const expected = Buffer.from(dk, "hex");
  if (calculated.length !== expected.length) return false;
  return timingSafeEqual(calculated, expected);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return null;
}
