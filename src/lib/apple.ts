import { SignJWT, importPKCS8 } from "jose"

// Sign in with Apple server-to-server calls. Apple requires apps to revoke the user's
// Apple token when they delete their account, which needs a refresh token obtained by
// exchanging the one-time authorization code from sign-in.
// Configured via APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (the .p8 contents of a
// "Sign in with Apple" key); without them these helpers do nothing.
const CLIENT_ID = (process.env.APPLE_BUNDLE_ID ?? "com.splititapp.ios").split(",")[0].trim()

export function appleServerConfigured(): boolean {
  return !!(process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY)
}

async function clientSecret(): Promise<string> {
  const pem = process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n")
  const key = await importPKCS8(pem, "ES256")
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_KEY_ID! })
    .setIssuer(process.env.APPLE_TEAM_ID!)
    .setAudience("https://appleid.apple.com")
    .setSubject(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key)
}

/** Exchanges a sign-in authorization code for Apple's refresh token (null on failure). */
export async function exchangeAppleCode(code: string): Promise<string | null> {
  if (!appleServerConfigured()) return null
  try {
    const res = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: await clientSecret(),
        code,
        grant_type: "authorization_code",
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json.refresh_token === "string" ? json.refresh_token : null
  } catch {
    return null
  }
}

/** Revokes the user's Sign in with Apple authorisation. Best effort: false on failure. */
export async function revokeAppleToken(refreshToken: string): Promise<boolean> {
  if (!appleServerConfigured()) return false
  try {
    const res = await fetch("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: await clientSecret(),
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
