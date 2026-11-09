import * as crypto from "crypto"

/** Pure refresh-token helpers. Kept free of Prisma/env imports so they can be unit-tested. */

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

/**
 * The refresh token that replaces `raw` on rotation. It is derived (HMAC of the old raw
 * token under the server secret) rather than random so that a client which lost the
 * rotation response and retries with the old token can be handed the *same* successor
 * again — the DB only keeps hashes, so a random successor could never be re-sent.
 * Deriving leaks nothing: without the secret the successor is unpredictable, and the old
 * token is already a bearer secret of equal power.
 */
export function deriveSuccessorToken(raw: string, secret: Uint8Array): string {
  return crypto.createHmac("sha256", secret).update(`refresh-rotate:${raw}`).digest("hex")
}

export type ReplayVerdict = "fresh" | "retry" | "theft"

/**
 * Classifies a presented refresh token: never used → "fresh" rotation; used within the
 * grace window → client "retry" (hand back the same successor); used earlier → "theft".
 */
export function classifyRefreshUse(usedAt: Date | null, now: number, graceMs: number): ReplayVerdict {
  if (!usedAt) return "fresh"
  return now - usedAt.getTime() <= graceMs ? "retry" : "theft"
}
