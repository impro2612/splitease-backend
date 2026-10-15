import { NextRequest } from "next/server"
import { OAuth2Client } from "google-auth-library"
import { prisma } from "@/lib/prisma"
import { normalizeEmail } from "@/lib/email"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request"
import { issueTokenPair } from "@/lib/tokens"

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

export async function POST(req: NextRequest) {
  try {
    if (!await checkRateLimit(`google-auth:${clientIp(req)}`, 20, 15 * 60 * 1000)) {
      return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
    }
    const { idToken, mode } = await req.json()
    if (!idToken) return Response.json({ error: "idToken required" }, { status: 400 })

    // Verify the ID token using google-auth-library (production-safe, uses Google's public certs)
    let googleId: string, email: string, name: string | undefined, image: string | undefined
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      })
      const p = ticket.getPayload()
      if (!p?.sub || !p.email || p.email_verified === false) throw new Error("Missing or unverified sub/email")
      googleId = p.sub
      email = normalizeEmail(p.email)
      name = p.name
      image = p.picture
    } catch {
      return Response.json({ error: "Invalid Google token" }, { status: 401 })
    }

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
