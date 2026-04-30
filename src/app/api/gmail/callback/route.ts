import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const appScheme = "splitit"

  if (error || !code || !state) {
    return Response.redirect(`${appScheme}://gmail-error?reason=${error ?? "missing_code"}`)
  }

  try {
    const { userId } = JSON.parse(Buffer.from(state, "base64url").toString())
    if (!userId) throw new Error("Invalid state")

    const redirectUri = `${process.env.NEXTAUTH_URL}/api/gmail/callback`
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    })

    const tokens = await tokenRes.json()
    if (!tokenRes.ok || tokens.error) throw new Error(tokens.error_description ?? "Token exchange failed")
    if (!tokens.refresh_token) throw new Error("No refresh token — ensure access_type=offline and prompt=consent")

    // Get the Gmail email address
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json()

    await prisma.gmailConnection.upsert({
      where: { userId },
      create: {
        userId,
        email: profile.email ?? "",
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
      },
      update: {
        email: profile.email ?? "",
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
        updatedAt: new Date(),
      },
    })

    // Redirect back to app with success deep link
    return Response.redirect(`${appScheme}://gmail-connected`)
  } catch (err) {
    console.error("Gmail callback error:", err)
    return Response.redirect(`${appScheme}://gmail-error?reason=server_error`)
  }
}
