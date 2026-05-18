// Rate limiter with two backends:
//   1. Upstash Redis  — production-grade, survives cold starts. Activated when
//      UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (add via Vercel
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
  const url   = process.env.UPSTASH_REDIS_REST_URL!
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!
  const windowSec = Math.ceil(windowMs / 1000)
  const redisKey  = `rl:${key}`

  // MULTI: INCR + EXPIRE in a single pipeline
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, windowSec, "NX"],
    ]),
  })
  if (!res.ok) return true // fail open — never block on infra errors
  const [[, count]] = await res.json() as [[string, number]]
  return count <= max
}

const useUpstash =
  typeof process !== "undefined" &&
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN

if (!useUpstash && typeof process !== "undefined" && process.env.NODE_ENV === "production") {
  console.warn("[rate-limit] Upstash env vars not set — falling back to in-memory rate limiting (ineffective in serverless). Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.")
}

export async function checkRateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (useUpstash) return upstashRateLimit(key, max, windowMs)
  return inMemoryRateLimit(key, max, windowMs)
}
