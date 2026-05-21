import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

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
      total: d.entries.reduce((s, e) => s + e.amount, 0) / 100,
      currency: d.entries[0]?.currency ?? "INR",
    }))
  )
}

// POST /api/spend-diary — create a new diary
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { title } = await req.json()
  if (!title?.trim()) return Response.json({ error: "title required" }, { status: 400 })

  const diary = await prisma.spendDiary.create({
    data: { userId: user.id, title: title.trim() },
  })

  return Response.json({ ...diary, entryCount: 0, total: 0 }, { status: 201 })
}
