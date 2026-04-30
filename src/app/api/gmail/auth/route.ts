import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import * as jose from "jose"
import { MOBILE_JWT_SECRET } from "@/lib/jwt-secret"

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

export async function GET(req: NextRequest) {
  // Primary: Authorization header (API calls). Fallback: ?token= query param (browser redirect from mobile app).
  let user = await getSessionUser(req)
  if (!user) {
    const qToken = new URL(req.url).searchParams.get("token")
    if (qToken) {
      try {
        const { payload } = await jose.jwtVerify(qToken, MOBILE_JWT_SECRET)
        if (payload.id && payload.email) {
          user = { id: payload.id as string, email: payload.email as string, name: payload.name as string | null }
        }
      } catch { /* invalid token */ }
    }
  }
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/gmail/callback`

  if (!clientId) return Response.json({ error: "Google OAuth not configured" }, { status: 500 })

  // Encode userId in state so callback knows which user to link
  const state = Buffer.from(JSON.stringify({ userId: user.id })).toString("base64url")

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  return Response.redirect(authUrl)
}
