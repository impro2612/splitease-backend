import { NextRequest } from "next/server"
import * as jose from "jose"
import * as crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { MOBILE_JWT_SECRET } from "@/lib/jwt-secret"

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

// POST /api/auth/mobile-refresh
// Body: { refreshToken: string }
// Returns: { token, refreshToken } — new access + rotated refresh token
// Token theft: if a used refresh token is replayed, revoke all tokens for that user
export async function POST(req: NextRequest) {
  try {
    const { refreshToken: rawToken } = await req.json()
    if (!rawToken) return Response.json({ error: "Refresh token required" }, { status: 400 })

    const hash = hashToken(rawToken)
    const stored = await prisma.mobileRefreshToken.findUnique({ where: { tokenHash: hash } })

    if (!stored) return Response.json({ error: "Invalid refresh token" }, { status: 401 })

    // Token theft detection: already used → revoke all tokens for this user
    if (stored.usedAt) {
      await prisma.mobileRefreshToken.deleteMany({ where: { userId: stored.userId } })
      return Response.json({ error: "Refresh token already used. Please sign in again." }, { status: 401 })
    }

    if (stored.expiresAt < new Date()) {
      await prisma.mobileRefreshToken.delete({ where: { tokenHash: hash } })
      return Response.json({ error: "Refresh token expired. Please sign in again." }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, email: true, name: true, image: true },
    })
    if (!user) return Response.json({ error: "User not found" }, { status: 401 })

    // Rotate: mark old token as used, issue new pair
    const newRaw = crypto.randomBytes(64).toString("hex")
    const newExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)

    await prisma.$transaction([
      prisma.mobileRefreshToken.update({ where: { tokenHash: hash }, data: { usedAt: new Date() } }),
      prisma.mobileRefreshToken.create({
        data: { userId: user.id, tokenHash: hashToken(newRaw), expiresAt: newExpiresAt },
      }),
    ])

    const newAccessToken = await new jose.SignJWT({ id: user.id, email: user.email, name: user.name })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .sign(MOBILE_JWT_SECRET)

    return Response.json({ token: newAccessToken, refreshToken: newRaw })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Server error" }, { status: 500 })
  }
}
