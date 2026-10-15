import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { maskEmail, normalizeEmail } from "@/lib/email"

// Emails are never matched by prefix/substring (that lets anyone harvest addresses by
// typing "@gmail"). Lookups are: exact email, or name prefix/substring — and name
// matches only reveal a masked email unless the person is already a friend.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (!await checkRateLimit(`user-search:${user.id}`, 60, 60 * 1000)) {
    return Response.json({ error: "Too many searches. Please slow down." }, { status: 429 })
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 3 || q.length > 100) return Response.json([])

  const select = { id: true, name: true, email: true, image: true } as const

  const [blocks, friendships] = await Promise.all([
    prisma.block.findMany({
      where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] },
      select: { blockerId: true, blockedId: true },
    }),
    prisma.friend.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
      select: { requesterId: true, addresseeId: true },
    }),
  ])
  const blockedIds = blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== user.id)
  const friendIds = new Set(friendships.flatMap((f) => [f.requesterId, f.addresseeId]))

  const notVisible = {
    id: { not: user.id, notIn: blockedIds },
    email: { not: { endsWith: "@deleted.invalid" } },
  }

  const [exact, prefix, substring] = await Promise.all([
    q.includes("@")
      ? prisma.user.findFirst({ where: { AND: [notVisible, { email: normalizeEmail(q) }] }, select })
      : Promise.resolve(null),
    prisma.user.findMany({ where: { AND: [notVisible, { name: { startsWith: q } }] }, select, take: 6 }),
    prisma.user.findMany({ where: { AND: [notVisible, { name: { contains: q } }] }, select, take: 10 }),
  ])

  const seen = new Set<string>()
  const results = []
  if (exact) { seen.add(exact.id); results.push(exact) }
  for (const u of [...prefix, ...substring]) {
    if (seen.has(u.id)) continue
    seen.add(u.id)
    results.push(friendIds.has(u.id) ? u : { ...u, email: maskEmail(u.email) })
    if (results.length === 10) break
  }

  return Response.json(results)
}
