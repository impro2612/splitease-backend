import { NextRequest } from "next/server"
import * as jose from "jose"
import * as crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { MOBILE_JWT_SECRET } from "@/lib/jwt-secret"

async function issueTokenPair(userId: string, email: string, name: string | null) {
  const accessToken = await new jose.SignJWT({ id: userId, email, name })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(MOBILE_JWT_SECRET)

  const rawRefresh = crypto.randomBytes(64).toString("hex")
  const tokenHash = crypto.createHash("sha256").update(rawRefresh).digest("hex")
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)

  await prisma.mobileRefreshToken.create({ data: { userId, tokenHash, expiresAt } })

  return { accessToken, refreshToken: rawRefresh }
}

export async function POST(req: NextRequest) {
  try {
    const { idToken, mode } = await req.json()
    if (!idToken) return Response.json({ error: "idToken required" }, { status: 400 })

    // Verify the ID token with Google's public tokeninfo endpoint
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`)
    const payload = await googleRes.json()

    if (!googleRes.ok || payload.error || !payload.email || !payload.sub) {
      return Response.json({ error: "Invalid Google token" }, { status: 401 })
    }

    const { sub: googleId, email, name, picture: image } = payload

    // Find by googleId first, then fall back to matching email
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email }] },
    })

    if (!user) {
      // Sign-in mode: reject if account doesn't exist
      if (mode === "signin") {
        return Response.json(
          { error: "No account found with this Google account. Please sign up first." },
          { status: 404 }
        )
      }
      // Sign-up mode: create new account
      user = await prisma.user.create({
        data: {
          email,
          name: name ?? email.split("@")[0],
          googleId,
          image: image ?? null,
        },
      })
    } else if (!user.googleId) {
      // An account with this email already exists but was created with a password.
      // Silently linking here would allow account takeover via Google without password proof.
      // Users must link Google from their authenticated profile settings instead.
      return Response.json(
        {
          error:
            "An account with this email already exists. Sign in with your password, then link Google from profile settings.",
        },
        { status: 409 }
      )
    }

    const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.name)

    return Response.json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      needsPhone: !user.phoneNormalized,
    })
  } catch (err) {
    console.error("[google-auth]", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
