import { NextRequest, after } from "next/server"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { prisma } from "@/lib/prisma"
import { normalizeEmail } from "@/lib/email"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request"
import { issueTokenPair } from "@/lib/tokens"
import { exchangeAppleCode } from "@/lib/apple"

// Apple's public signing keys; jose caches them between requests
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"))
const APPLE_AUDIENCE = (process.env.APPLE_BUNDLE_ID ?? "com.splititapp.ios").split(",").map((s) => s.trim())

export async function POST(req: NextRequest) {
  try {
    if (!await checkRateLimit(`apple-auth:${clientIp(req)}`, 20, 15 * 60 * 1000)) {
      return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
    }
    const { identityToken, fullName, mode, authorizationCode } = await req.json()
    if (!identityToken || typeof identityToken !== "string") {
      return Response.json({ error: "identityToken required" }, { status: 400 })
    }

    // Verify the identity token against Apple's keys, issuer and our bundle ID
    let appleId: string, email: string | null
    try {
      const { payload } = await jwtVerify(identityToken, appleKeys, {
        issuer: "https://appleid.apple.com",
        audience: APPLE_AUDIENCE,
      })
      if (!payload.sub) throw new Error("Missing sub")
      appleId = payload.sub
      const verified = payload.email_verified === true || payload.email_verified === "true"
      email = typeof payload.email === "string" && verified ? normalizeEmail(payload.email) : null
    } catch {
      return Response.json({ error: "Invalid Apple token" }, { status: 401 })
    }

    // Apple only sends the user's name on the very first authorisation, from the device
    const name = typeof fullName === "string" && fullName.trim() ? fullName.trim().slice(0, 80) : undefined

    let user = await prisma.user.findFirst({
      where: email ? { OR: [{ appleId }, { email }] } : { appleId },
    })

    if (!user) {
      if (mode === "signin") {
        return Response.json(
          { error: "No account found with this Apple ID. Please sign up first." },
          { status: 404 }
        )
      }
      if (!email) {
        return Response.json(
          { error: "Apple didn't share an email address. Please sign up with email instead." },
          { status: 400 }
        )
      }
      user = await prisma.user.create({
        data: { email, name: name ?? email.split("@")[0], appleId },
      })
    } else if (user.appleId !== appleId) {
      // Same email, but the account was made another way (password or Google).
      // Linking silently would let an Apple ID take over that account.
      return Response.json(
        { error: "An account with this email already exists. Sign in the way you created it (email and password, or Google)." },
        { status: 409 }
      )
    }

    // Keep Apple's refresh token so the authorisation can be revoked if the account is deleted
    if (typeof authorizationCode === "string" && authorizationCode) {
      const userId = user.id
      after(async () => {
        const appleRefresh = await exchangeAppleCode(authorizationCode)
        if (appleRefresh) await prisma.user.update({ where: { id: userId }, data: { appleRefreshToken: appleRefresh } }).catch(() => {})
      })
    }

    const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.name)

    return Response.json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      needsPhone: !user.phoneNormalized,
    })
  } catch (err) {
    console.error("[apple-auth]", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
