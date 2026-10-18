import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { getPlusStatus } from "@/lib/plus"
import { syncPlusFromRevenueCat } from "@/lib/revenuecat"
import { checkRateLimit } from "@/lib/rate-limit"

// POST /api/plus/sync — called by the app right after a purchase or restore,
// so access unlocks immediately instead of waiting for the webhook.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!await checkRateLimit(`plus-sync:${user.id}`, 20, 15 * 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }
  await syncPlusFromRevenueCat(user.id)
  return Response.json(await getPlusStatus(user.id))
}
