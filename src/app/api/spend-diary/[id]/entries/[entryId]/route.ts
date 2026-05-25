import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// PATCH /api/spend-diary/[id]/entries/[entryId] — edit entry
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id, entryId } = await params
  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  const { title, amount, currency, date } = await req.json()
  if (!title?.trim() || typeof amount !== "number" || amount <= 0) {
    return Response.json({ error: "title and positive amount required" }, { status: 400 })
  }

  const entry = await prisma.spendEntry.update({
    where: { id: entryId, diaryId: id },
    data: {
      title: title.trim(),
      amount: Math.round(amount * 100),
      currency: currency ?? "INR",
      date: date ? new Date(date) : undefined,
    },
  })

  await prisma.spendDiary.update({ where: { id }, data: { updatedAt: new Date() } })
  return Response.json({ ...entry, amount: entry.amount / 100 })
}

// DELETE /api/spend-diary/[id]/entries/[entryId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id, entryId } = await params
  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  await prisma.spendEntry.deleteMany({ where: { id: entryId, diaryId: id } })
  return Response.json({ success: true })
}
