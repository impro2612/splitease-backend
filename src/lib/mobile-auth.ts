import { NextRequest } from "next/server"
import * as jose from "jose"
import { getServerSession } from "next-auth"
import { authOptions } from "./auth"

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET ?? "fallback-secret-change-in-production"
)

type SessionUser = { id: string; email: string; name?: string | null }

// Works for both web (NextAuth session) and mobile (Bearer JWT)
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  // 1. Try Bearer token (mobile)
  const authHeader = req.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    try {
      const { payload } = await jose.jwtVerify(token, SECRET)
      if (payload.id && payload.email) {
        return { id: payload.id as string, email: payload.email as string, name: payload.name as string }
      }
    } catch {
      return null
    }
  }

  // 2. Fall back to NextAuth session (web)
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    return { id: session.user.id, email: session.user.email ?? "", name: session.user.name }
  }

  return null
}
