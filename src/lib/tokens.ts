import * as jose from "jose"
import * as crypto from "crypto"
import { prisma } from "./prisma"
import { MOBILE_JWT_SECRET } from "./jwt-secret"

// Short-lived access token; the mobile client refreshes transparently on 401.
export const ACCESS_TOKEN_TTL = "1h"
export const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000 // 60 days

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

export async function signAccessToken(userId: string, email: string, name: string | null) {
  return new jose.SignJWT({ id: userId, email, name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(MOBILE_JWT_SECRET)
}

/** Issues an access token plus a fresh refresh token (only its SHA-256 is stored). */
export async function issueTokenPair(userId: string, email: string, name: string | null) {
  const accessToken = await signAccessToken(userId, email, name)
  const rawRefresh = crypto.randomBytes(64).toString("hex")
  await prisma.mobileRefreshToken.create({
    data: { userId, tokenHash: hashToken(rawRefresh), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
  })
  return { accessToken, refreshToken: rawRefresh }
}
