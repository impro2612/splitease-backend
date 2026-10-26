import { prisma } from "@/lib/prisma"
import { plusStatus, type PlusStatus } from "./plus-status"
import { syncPlusFromRevenueCat } from "./revenuecat"
import { checkRateLimit } from "./rate-limit"

export { TRIAL_DAYS, trialEnd, plusStatus, type PlusStatus } from "./plus-status"

const RESYNC_WINDOW = 3 * 24 * 60 * 60 * 1000

export async function getPlusStatus(userId: string): Promise<PlusStatus> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, trialEndsAt: true, plusUntil: true, plusWillRenew: true },
  })
  if (!u) return { access: false, plan: "free", trialEndsAt: null, plusUntil: null, daysLeft: 0, willRenew: null }
  // A subscription that just reached its end date has usually renewed (monthly ones do so
  // 12 times a year): if the renewal webhook hasn't landed yet, ask RevenueCat directly
  // rather than locking a paying user out. Throttled so a lapsed user can't hammer it.
  const now = Date.now()
  const ended = u.plusUntil?.getTime()
  if (ended && ended <= now && now - ended < RESYNC_WINDOW && await checkRateLimit(`plus-resync:${userId}`, 1, 10 * 60 * 1000)) {
    const fresh = await syncPlusFromRevenueCat(userId)
    if (fresh !== undefined) u.plusUntil = fresh
  }
  return plusStatus(u)
}

// Route guard: returns a 402 response when the user has no Plus access, else null.
export async function requirePlus(userId: string): Promise<Response | null> {
  const s = await getPlusStatus(userId)
  if (s.access) return null
  return Response.json(
    { error: "This feature needs SplitIT Plus", code: "PLUS_REQUIRED" },
    { status: 402 },
  )
}
