import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"

// GET /api/spend-diary — list all diaries with entry count and total
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const diaries = await prisma.spendDiary.findMany({
    where: { userId: user.id },
    include: { entries: { select: { amount: true, currency: true } } },
    orderBy: { createdAt: "desc" },
  })

  return Response.json(
    diaries.map((d) => ({
      id: d.id,
      title: d.title,
      createdAt: d.createdAt,
      entryCount: d.entries.length,
      ...(() => {
        // Totals are per currency — mixed-currency diaries must not be summed together
        const totals: Record<string, number> = {}
        for (const e of d.entries) totals[e.currency] = (totals[e.currency] ?? 0) + e.amount
        const codes = Object.keys(totals)
        const main = codes.sort((a, b) => totals[b] - totals[a])[0] ?? "INR"
        return {
          total: (totals[main] ?? 0) / 100,
          currency: main,
          totals: Object.fromEntries(codes.map((c) => [c, totals[c] / 100])),
        }
      })(),
    }))
  )
}

// POST /api/spend-diary — create a new diary
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (!await checkRateLimit(`spend-diary:${user.id}`, 30, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }
  const { title } = await req.json().catch(() => ({ title: undefined }))
  if (typeof title !== "string" || !title.trim() || title.length > 100) return Response.json({ error: "title required" }, { status: 400 })

  const diary = await prisma.spendDiary.create({
    data: { userId: user.id, title: title.trim() },
  })

  return Response.json({ ...diary, entryCount: 0, total: 0 }, { status: 201 })
}
