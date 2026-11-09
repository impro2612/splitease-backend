import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { checkRateLimit } from "@/lib/rate-limit"

// Only the per-photo download-tracking endpoint may be hit with our key — anything else
// on api.unsplash.com would turn this into an open proxy for the server credential.
const DOWNLOAD_RE = /^https:\/\/api\.unsplash\.com\/photos\/[A-Za-z0-9_-]{1,40}\/download(\?[A-Za-z0-9_=&%.-]*)?$/

// POST /api/group-image/select — { downloadLocation } tells Unsplash a photo was chosen
// (required by their API guidelines). No-op for other sources.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!await checkRateLimit(`unsplash-select:${user.id}`, 30, 60 * 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }
  const key = process.env.UNSPLASH_ACCESS_KEY
  const { downloadLocation } = await req.json().catch(() => ({}))
  if (key && typeof downloadLocation === "string" && DOWNLOAD_RE.test(downloadLocation)) {
    await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(4_000),
    }).catch(() => {})
  }
  return Response.json({ ok: true })
}
