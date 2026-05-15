// In-memory rate limiter — replace the Map with Redis in a multi-instance production setup.
// For single-instance Vercel deployments this is sufficient; the Map resets on cold starts.

type Window = { timestamps: number[]; windowMs: number; max: number }
const store = new Map<string, Window>()

export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
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
