// Rate limiter with two backends:
//   1. Upstash Redis  — production-grade, survives cold starts. Activated when
//      UPSTASH_REDIS_REST_* or KV_REST_API_* URL+TOKEN are set (add via Vercel
//      Marketplace → Upstash, or set manually in the dashboard).
//   2. In-memory Map  — zero-config fallback for local dev and single-instance deploys.
//      Resets on cold starts; adequate when traffic is low.

type Window = { timestamps: number[]; windowMs: number; max: number }
const store = new Map<string, Window>()

function inMemoryRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)
  if (!entry) {
    store.set(key, { timestamps: [now], windowMs, max })
    return true
  }
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)
  if (entry.timestamps.length >= max) return false
  entry.timestamps.push(now)
  return true
}

async function upstashRateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const url   = REDIS_URL!
  const token = REDIS_TOKEN!
  const windowSec = Math.ceil(windowMs / 1000)
  const redisKey  = `rl:${key}`

  // MULTI: INCR + EXPIRE in a single pipeline. Any infra failure (DNS, timeout, deleted
  // database, bad response) falls back to the in-memory limiter — it must never turn
  // sign-in into a 500.
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, windowSec, "NX"],
      ]),
      signal: AbortSignal.timeout(2_000),
    })
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`)
    const results = await res.json() as { result: number }[]
    const count = results[0]?.result ?? 0
    return count <= max
  } catch (err) {
    console.error("[rate-limit] Upstash unavailable, using in-memory fallback:", err instanceof Error ? err.message : err)
    return inMemoryRateLimit(key, max, windowMs)
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

export async function checkRateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (useUpstash) return upstashRateLimit(key, max, windowMs)
  return inMemoryRateLimit(key, max, windowMs)
}
