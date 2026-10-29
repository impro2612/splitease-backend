import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"

// POST /api/group-image/select — { downloadLocation } tells Unsplash a photo was chosen
// (required by their API guidelines). No-op for other sources.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const key = process.env.UNSPLASH_ACCESS_KEY
  const { downloadLocation } = await req.json().catch(() => ({}))
  if (key && typeof downloadLocation === "string" && downloadLocation.startsWith("https://api.unsplash.com/")) {
    await fetch(downloadLocation, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {})
  }
  return Response.json({ ok: true })
}
