import { prisma } from "@/lib/prisma"
import { pusherServer } from "@/lib/pusher"

// RevenueCat is the source of truth for store subscriptions (App Store + Play).
// The app logs in to RevenueCat with our user id, so app_user_id === User.id.
export const PLUS_ENTITLEMENT = "plus"

/** Tells the user's open apps to re-read their Plus status right away. */
export async function notifyPlusChanged(userId: string) {
  await pusherServer.trigger(`private-user-${userId}`, "plus-updated", {}).catch(() => {})
}

// Reads the subscriber from RevenueCat and stores the Plus expiry on the user.
// Returns the new plusUntil, or undefined when RevenueCat isn't configured / unreachable.
export async function syncPlusFromRevenueCat(userId: string): Promise<Date | null | undefined> {
  const key = process.env.REVENUECAT_SECRET_KEY
  if (!key) return undefined
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    })
    if (!res.ok) return undefined
    const json = await res.json()
    const ent = json?.subscriber?.entitlements?.[PLUS_ENTITLEMENT]
    // expires_date null on an active entitlement = lifetime purchase
    const until = ent ? (ent.expires_date ? new Date(ent.expires_date) : new Date("2100-01-01")) : null
    const before = await prisma.user.findUnique({ where: { id: userId }, select: { plusUntil: true } })
    await prisma.user.update({ where: { id: userId }, data: { plusUntil: until } })
    if ((before?.plusUntil?.getTime() ?? null) !== (until?.getTime() ?? null)) await notifyPlusChanged(userId)
    return until
  } catch {
    return undefined
  }
}
