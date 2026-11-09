import { prisma } from "@/lib/prisma"
import { plusStatus, type PlusStatus } from "./plus-status"
import { syncPlusFromRevenueCat } from "./revenuecat"
import { checkRateLimit } from "./rate-limit"

export { TRIAL_DAYS, trialEnd, plusStatus, type PlusStatus } from "./plus-status"

const RESYNC_WINDOW = 3 * 24 * 60 * 60 * 1000

// Per-instance memo so every Plus-gated route doesn't re-read the user row the JWT already
// vouched for. A locked-out result is kept only briefly so someone who just bought Plus
// is unlocked within seconds; status changes we make ourselves clear it immediately.
const CACHE_TTL = 60_000
const LOCKED_TTL = 10_000
const MAX_CACHE = 5_000
const cache = new Map<string, { status: PlusStatus; expires: number }>()

export function invalidatePlusCache(userId: string) {
  cache.delete(userId)
}

function remember(userId: string, status: PlusStatus, now: number) {
  if (cache.size >= MAX_CACHE) {
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k)
    if (cache.size >= MAX_CACHE) cache.clear() // still full of live entries: start over
  }
  cache.set(userId, { status, expires: now + (status.access ? CACHE_TTL : LOCKED_TTL) })
}

export async function getPlusStatus(userId: string): Promise<PlusStatus> {
  const now = Date.now()
  const hit = cache.get(userId)
  if (hit && hit.expires > now) return hit.status

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, trialEndsAt: true, plusUntil: true, plusWillRenew: true },
  })
  if (!u) return { access: false, plan: "free", trialEndsAt: null, plusUntil: null, daysLeft: 0, willRenew: null }
  // A subscription that just reached its end date has usually renewed (monthly ones do so
  // 12 times a year): if the renewal webhook hasn't landed yet, ask RevenueCat directly
  // rather than locking a paying user out. Throttled so a lapsed user can't hammer it.
  const ended = u.plusUntil?.getTime()
  if (ended && ended <= now && now - ended < RESYNC_WINDOW && await checkRateLimit(`plus-resync:${userId}`, 1, 10 * 60 * 1000)) {
    const fresh = await syncPlusFromRevenueCat(userId)
    if (fresh !== undefined) u.plusUntil = fresh
  }
  const status = plusStatus(u)
  remember(userId, status, now)
  return status
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
