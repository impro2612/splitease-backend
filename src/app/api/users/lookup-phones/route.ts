import { NextRequest } from "next/server"
import { Prisma } from "@/generated/prisma/client"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/phone"

const PHONES_PER_REQUEST = 100
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20  // 20 × 100 = 2000 contacts per minute

// In-memory rate limiter: userId → [timestamp, ...] — replace with Redis in prod
const rateLimitMap = new Map<string, number[]>()
function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const hits = (rateLimitMap.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  hits.push(now)
  rateLimitMap.set(userId, hits)
  return hits.length > RATE_LIMIT_MAX
}

// POST /api/users/lookup-phones
// Body: { phones: string[] }
// Returns: { [sentPhone]: { id, name, email, image } } — keyed by what was sent
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (isRateLimited(user.id)) {
    return Response.json({ error: "Too many requests. Please wait before retrying." }, { status: 429 })
  }

  const { phones } = await req.json()
  if (!Array.isArray(phones) || phones.length === 0) return Response.json({})

  const limited = phones
    .slice(0, PHONES_PER_REQUEST)
    .map((phone) => normalizePhone(String(phone ?? "")))
    .filter(Boolean)

  if (limited.length === 0) return Response.json({})

  // Numbers with country code (+...) → exact match
  // Numbers without + → suffix match (contact saved without country code)
  const withCC = limited.filter((p) => p.startsWith("+"))
  const localOnly = limited.filter((p) => !p.startsWith("+") && p.length >= 6)

  const orConditions: Prisma.UserWhereInput[] = []
  if (withCC.length > 0) orConditions.push({ phoneNormalized: { in: withCC } })
  for (const local of localOnly) orConditions.push({ phoneNormalized: { endsWith: local } })

  if (orConditions.length === 0) return Response.json({})

  const users = await prisma.user.findMany({
    where: { OR: orConditions, id: { not: user.id } },
    select: { id: true, name: true, email: true, image: true, phoneNormalized: true },
  })

  // Key the result by what the mobile sent so the client lookup works without changes
  const result: Record<string, { id: string; name: string | null; email: string; image: string | null }> = {}
  for (const u of users) {
    if (!u.phoneNormalized) continue
    const info = { id: u.id, name: u.name, email: u.email, image: u.image }
    // Exact match
    if (limited.includes(u.phoneNormalized)) {
      result[u.phoneNormalized] = info
    }
    // Suffix match — find which local-only number this DB entry ends with
    for (const local of localOnly) {
      if (u.phoneNormalized.endsWith(local)) {
        result[local] = info
        break
      }
    }
  }

  return Response.json(result)
}
