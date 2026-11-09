import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIp, readJson } from "@/lib/request"
import { hashToken, REFRESH_TOKEN_TTL_MS, signAccessToken } from "@/lib/tokens"
import { classifyRefreshUse, deriveSuccessorToken } from "@/lib/token-utils"
import { MOBILE_JWT_SECRET } from "@/lib/jwt-secret"

// A rotated token replayed within this window is treated as a client retry (the app
// was killed or lost the response before saving the new pair), not as theft.
const REUSE_GRACE_MS = 60 * 1000

// POST /api/auth/mobile-refresh
// Body: { refreshToken: string }
// Returns: { token, refreshToken } — new access + rotated refresh token
//
// Rotation: the successor refresh token is *derived* from the presented one (see
// deriveSuccessorToken), so a retry inside the grace window gets back exactly the pair
// the first rotation produced — no extra tokens are minted for replays, and the family
// stays a single chain. A replay after the grace window, or one whose successor was
// already consumed, is token theft: every refresh token for that user is revoked.
export async function POST(req: NextRequest) {
  try {
    if (!await checkRateLimit(`refresh:${clientIp(req)}`, 60, 15 * 60 * 1000)) {
      return Response.json({ error: "Too many requests" }, { status: 429 })
    }
    const { refreshToken: rawToken } = await readJson<{ refreshToken: string }>(req)
    if (typeof rawToken !== "string" || !rawToken) {
      return Response.json({ error: "Refresh token required" }, { status: 400 })
    }

    const hash = hashToken(rawToken)
    const stored = await prisma.mobileRefreshToken.findUnique({ where: { tokenHash: hash } })

    if (!stored) return Response.json({ error: "Invalid refresh token" }, { status: 401 })

    const now = Date.now()
    const verdict = classifyRefreshUse(stored.usedAt, now, REUSE_GRACE_MS)
    if (verdict === "theft") {
      await prisma.mobileRefreshToken.deleteMany({ where: { userId: stored.userId } })
      return Response.json({ error: "Refresh token already used. Please sign in again." }, { status: 401 })
    }

    if (stored.expiresAt.getTime() < now) {
      await prisma.mobileRefreshToken.delete({ where: { tokenHash: hash } })
      return Response.json({ error: "Refresh token expired. Please sign in again." }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, email: true, name: true },
    })
    if (!user) return Response.json({ error: "User not found" }, { status: 401 })

    const successorRaw = deriveSuccessorToken(rawToken, MOBILE_JWT_SECRET)
    const successorHash = hashToken(successorRaw)

    if (verdict === "retry") {
      // Same pair as the first rotation (access tokens aren't stored, so a fresh one is signed)
      const successor = await prisma.mobileRefreshToken.findUnique({ where: { tokenHash: successorHash } })
      if (successor && !successor.usedAt && successor.expiresAt.getTime() > now) {
        return Response.json({ token: await signAccessToken(user.id, user.email, user.name), refreshToken: successorRaw })
      }
      // The successor is gone or already spent, so whoever holds it has moved on: this
      // replay didn't come from a lost response. Treat as theft.
      await prisma.mobileRefreshToken.deleteMany({ where: { userId: stored.userId } })
      return Response.json({ error: "Refresh token already used. Please sign in again." }, { status: 401 })
    }

    // Rotate: mark old token as used, store the successor's hash
    await prisma.$transaction([
      prisma.mobileRefreshToken.update({ where: { tokenHash: hash }, data: { usedAt: new Date(now) } }),
      prisma.mobileRefreshToken.create({
        data: { userId: user.id, tokenHash: successorHash, expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS) },
      }),
    ])

    const newAccessToken = await signAccessToken(user.id, user.email, user.name)
    return Response.json({ token: newAccessToken, refreshToken: successorRaw })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Server error" }, { status: 500 })
  }
}
