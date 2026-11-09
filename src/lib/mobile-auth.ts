import { NextRequest } from "next/server"
import * as jose from "jose"
import { MOBILE_JWT_SECRET } from "./jwt-secret"

type SessionUser = { id: string; email: string; name?: string | null }

// Mobile Bearer JWT only. The legacy NextAuth cookie session (and its unthrottled
// credentials callback) was removed: the website is a brochure site, the product is the apps.
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  try {
    const { payload } = await jose.jwtVerify(authHeader.slice(7), MOBILE_JWT_SECRET)
    if (payload.id && payload.email) {
      return { id: payload.id as string, email: payload.email as string, name: payload.name as string }
    }
  } catch {
    // expired or forged token
  }
  return null
}
