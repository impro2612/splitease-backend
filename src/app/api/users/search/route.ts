import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 3) return Response.json([])

  const select = { id: true, name: true, email: true, image: true } as const
  const notMe = { id: { not: user.id } }

  // Three ranked tiers — exact email → prefix → substring
  const [exact, prefix, substring] = await Promise.all([
    prisma.user.findFirst({
      where: { AND: [notMe, { email: q.toLowerCase() }] },
      select,
    }),
    prisma.user.findMany({
      where: {
        AND: [
          notMe,
          { OR: [{ email: { startsWith: q } }, { name: { startsWith: q } }] },
        ],
      },
      select,
      take: 6,
    }),
    prisma.user.findMany({
      where: {
        AND: [
          notMe,
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
