import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// GET /api/spend-diary/[id]/entries — list entries for a diary
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  const entries = await prisma.spendEntry.findMany({
    where: { diaryId: id },
    orderBy: { date: "desc" },
  })

  return Response.json(entries.map((e) => ({ ...e, amount: e.amount / 100 })))
}

// POST /api/spend-diary/[id]/entries — add an entry
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  const { title, amount, currency, date } = await req.json()
  if (!title?.trim() || typeof amount !== "number" || amount <= 0) {
    return Response.json({ error: "title and positive amount required" }, { status: 400 })
  }

  const entry = await prisma.spendEntry.create({
    data: {
      diaryId: id,
      title: title.trim(),
      amount: Math.round(amount * 100),
      currency: currency ?? "INR",
      date: date ? new Date(date) : new Date(),
    },
  })

  await prisma.spendDiary.update({ where: { id }, data: { updatedAt: new Date() } })

  return Response.json({ ...entry, amount: entry.amount / 100 }, { status: 201 })
}
