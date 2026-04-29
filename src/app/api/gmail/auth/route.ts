import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
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
