import { NextRequest } from "next/server"
import * as jose from "jose"
import { prisma } from "@/lib/prisma"
import { MOBILE_JWT_SECRET } from "@/lib/jwt-secret"

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
      // Link Google account to existing email/password user
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId, image: user.image ?? image ?? null },
      })
    }

    const token = await new jose.SignJWT({
      id: user.id,
      email: user.email,
      name: user.name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(MOBILE_JWT_SECRET)

    return Response.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      needsPhone: !user.phoneNormalized,
    })
  } catch (err) {
    console.error("[google-auth]", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
