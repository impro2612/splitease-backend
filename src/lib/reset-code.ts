import * as crypto from "crypto"

export const MAX_RESET_ATTEMPTS = 5

/** Codes are stored hashed and bound to the email, so equal codes for two users never collide. */
export function hashResetCode(email: string, code: string): string {
  return crypto.createHash("sha256").update(`${email}:${code}`).digest("hex")
}

export function resetCodeMatches(email: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashResetCode(email, code), "hex")
  const b = Buffer.from(storedHash, "hex")
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
