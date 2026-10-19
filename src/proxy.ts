import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// The website is a single branding page (plus /privacy and /terms); the product lives in
// the mobile apps. Old web-app links (sign in, dashboard, groups…) go to the home page.
// API routes are untouched — they serve the mobile apps.
const OLD_APP_PATHS = ["/signin", "/signup", "/dashboard", "/groups", "/friends"]

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (OLD_APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL("/", req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/signin", "/signup", "/dashboard/:path*", "/groups/:path*", "/friends/:path*"],
}
