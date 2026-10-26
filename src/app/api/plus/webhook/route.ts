import { NextRequest } from "next/server"
import { timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"
import { notifyPlusChanged, syncPlusFromRevenueCat } from "@/lib/revenuecat"

function authorized(req: NextRequest): boolean {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH
  const got = req.headers.get("authorization") ?? ""
  if (!expected) return false
  const a = Buffer.from(got), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// POST /api/plus/webhook — RevenueCat subscription events (purchase, renewal,
// cancellation, expiry, refund…). We re-read the subscriber instead of trusting
// the event body, so out-of-order events can't leave a stale expiry.
export async function POST(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  const event = body?.event
  if (!event) return Response.json({ ok: true })

  const ids: string[] = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]
    .filter((x: unknown): x is string => typeof x === "string" && !x.startsWith("$RCAnonymousID"))
  const user = ids.length
    ? await prisma.user.findFirst({ where: { id: { in: ids } }, select: { id: true } })
    : null
  if (!user) return Response.json({ ok: true }) // not one of ours (e.g. sandbox test user)

  const synced = await syncPlusFromRevenueCat(user.id)
  if (synced === undefined && typeof event.expiration_at_ms === "number") {
    // Fallback when the REST lookup isn't available
    const until = new Date(event.expiration_at_ms)
    const willRenew = event.type === "CANCELLATION" ? false
      : ["RENEWAL", "UNCANCELLATION", "INITIAL_PURCHASE", "PRODUCT_CHANGE"].includes(event.type) ? true : undefined
    await prisma.user.update({
      where: { id: user.id },
      data: { plusUntil: until, ...(willRenew === undefined ? {} : { plusWillRenew: willRenew, plusEndReminder: null }) },
    })
    await notifyPlusChanged(user.id)
  }
  return Response.json({ ok: true })
}
