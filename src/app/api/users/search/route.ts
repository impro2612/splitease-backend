import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 3) return Response.json([])

  const select = { id: true, name: true, email: true, image: true } as const

  // Get IDs of users blocked by or blocking the current user
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] },
    select: { blockerId: true, blockedId: true },
  })
  const blockedIds = new Set(
    blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== user.id)
  )

  const notVisible = { id: { not: user.id, notIn: Array.from(blockedIds) } }

  // Three ranked tiers — exact email → prefix → substring
  const [exact, prefix, substring] = await Promise.all([
    prisma.user.findFirst({
      where: { AND: [notVisible, { email: q.toLowerCase() }] },
      select,
    }),
    prisma.user.findMany({
      where: {
        AND: [
          notVisible,
          { OR: [{ email: { startsWith: q } }, { name: { startsWith: q } }] },
        ],
      },
      select,
      take: 6,
    }),
    prisma.user.findMany({
      where: {
        AND: [
          notVisible,
          { OR: [{ email: { contains: q } }, { name: { contains: q } }] },
        ],
      },
      select,
      take: 10,
    }),
  ])

  // Merge tiers, deduplicate by id, cap at 10
  const seen = new Set<string>()
  const results = []
  for (const u of [exact, ...prefix, ...substring]) {
    if (!u || seen.has(u.id)) continue
    seen.add(u.id)
    results.push(u)
    if (results.length === 10) break
  }

  return Response.json(results)
}
