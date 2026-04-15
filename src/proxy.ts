import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  const publicPaths = ["/", "/signin", "/signup"]
  const isPublic = publicPaths.includes(pathname) || pathname.startsWith("/api/auth")

  // API routes handle their own auth (Bearer JWT for mobile, session for web).
  // Never redirect API calls — they must return JSON, not an HTML signin page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next()
  }

  // Redirect authenticated users away from auth pages
  if (token && (pathname === "/signin" || pathname === "/signup" || pathname === "/")) {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }

  // Redirect unauthenticated users to signin
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/signin", req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
