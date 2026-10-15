import { NextRequest } from "next/server"
import * as crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIp, readJson } from "@/lib/request"
import { hashToken, REFRESH_TOKEN_TTL_MS, signAccessToken } from "@/lib/tokens"

// A rotated token replayed within this window is treated as a client retry (the app
// was killed or lost the response before saving the new pair), not as theft.
const REUSE_GRACE_MS = 60 * 1000

// POST /api/auth/mobile-refresh
// Body: { refreshToken: string }
// Returns: { token, refreshToken } — new access + rotated refresh token
// Token theft: if a used refresh token is replayed after the grace window, revoke all tokens for that user
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

    if (stored.usedAt && Date.now() - stored.usedAt.getTime() > REUSE_GRACE_MS) {
      await prisma.mobileRefreshToken.deleteMany({ where: { userId: stored.userId } })
      return Response.json({ error: "Refresh token already used. Please sign in again." }, { status: 401 })
    }

    if (stored.expiresAt < new Date()) {
      await prisma.mobileRefreshToken.delete({ where: { tokenHash: hash } })
      return Response.json({ error: "Refresh token expired. Please sign in again." }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, email: true, name: true },
    })
    if (!user) return Response.json({ error: "User not found" }, { status: 401 })

    // Rotate: mark old token as used, issue new pair
    const newRaw = crypto.randomBytes(64).toString("hex")
    await prisma.$transaction([
      prisma.mobileRefreshToken.update({ where: { tokenHash: hash }, data: { usedAt: stored.usedAt ?? new Date() } }),
      prisma.mobileRefreshToken.create({
        data: { userId: user.id, tokenHash: hashToken(newRaw), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
      }),
    ])

    const newAccessToken = await signAccessToken(user.id, user.email, user.name)
    return Response.json({ token: newAccessToken, refreshToken: newRaw })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Server error" }, { status: 500 })
  }
}
