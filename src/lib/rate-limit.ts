// Rate limiter with two backends:
//   1. Upstash Redis  — production-grade, survives cold starts. Activated when
//      UPSTASH_REDIS_REST_* or KV_REST_API_* URL+TOKEN are set (add via Vercel
//      Marketplace → Upstash, or set manually in the dashboard).
//   2. In-memory Map  — zero-config fallback for local dev and single-instance deploys.
//      Resets on cold starts; adequate when traffic is low.

type Window = { timestamps: number[]; windowMs: number; max: number }
const store = new Map<string, Window>()

// Keys whose whole window has elapsed are dropped whenever a new key is inserted, so the
// Map can't grow without bound on a long-lived instance (one unique key per IP/user).
function pruneExpired(now: number) {
  for (const [key, entry] of store) {
    const last = entry.timestamps[entry.timestamps.length - 1]
    if (last === undefined || now - last >= entry.windowMs) store.delete(key)
  }
}

/** In-memory sliding window. Exported for tests; `now` is injectable for the same reason. */
export function inMemoryRateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const entry = store.get(key)
  if (!entry) {
    pruneExpired(now)
    store.set(key, { timestamps: [now], windowMs, max })
    return true
  }
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)
  if (entry.timestamps.length >= max) return false
  entry.timestamps.push(now)
  return true
}

/** Number of keys currently held by the in-memory store (tests). */
export function inMemoryStoreSize(): number {
  return store.size
}

export type RateLimit = { key: string; max: number; windowMs: number }

// One Upstash pipeline for every limit: INCR + EXPIRE per key, in order, so N checks cost
// a single HTTP round trip instead of N. Any infra failure (DNS, timeout, deleted database,
// bad response) falls back to the in-memory limiter — it must never turn sign-in into a 500.
async function upstashRateLimits(limits: RateLimit[]): Promise<boolean[]> {
  const url   = REDIS_URL!
  const token = REDIS_TOKEN!
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(limits.flatMap(({ key, windowMs }) => [
        ["INCR", `rl:${key}`],
        ["EXPIRE", `rl:${key}`, Math.ceil(windowMs / 1000), "NX"],
      ])),
      signal: AbortSignal.timeout(2_000),
    })
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`)
    const results = await res.json() as { result?: number; error?: string }[]
    if (!Array.isArray(results) || results.length !== limits.length * 2) throw new Error("Upstash: unexpected pipeline response")
    return limits.map((l, i) => {
      const r = results[i * 2]
      if (r?.error || typeof r?.result !== "number") throw new Error(r?.error ?? "Upstash: bad INCR result")
      return r.result <= l.max
    })
  } catch (err) {
    console.error("[rate-limit] Upstash unavailable, using in-memory fallback:", err instanceof Error ? err.message : err)
    return limits.map((l) => inMemoryRateLimit(l.key, l.max, l.windowMs))
  }
}

// Accept both naming schemes: UPSTASH_REDIS_REST_* (manual setup / Upstash console) and
// KV_REST_API_* (what the Vercel Marketplace Upstash integration injects).
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN

const useUpstash = typeof process !== "undefined" && !!REDIS_URL && !!REDIS_TOKEN

if (!useUpstash && typeof process !== "undefined" && process.env.NODE_ENV === "production") {
  console.warn("[rate-limit] No Redis configured — falling back to in-memory rate limiting (ineffective in serverless). Connect Upstash Redis to this project in Vercel (Storage tab).")
}

/** Checks several limits at once — one Redis round trip. Returns one boolean per limit, in order. */
export async function checkRateLimits(limits: RateLimit[]): Promise<boolean[]> {
  if (limits.length === 0) return []
  if (useUpstash) return upstashRateLimits(limits)
  return limits.map((l) => inMemoryRateLimit(l.key, l.max, l.windowMs))
}

export async function checkRateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const [ok] = await checkRateLimits([{ key, max, windowMs }])
  return ok
}
