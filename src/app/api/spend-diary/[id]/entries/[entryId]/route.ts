import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { CURRENCY_RE, parseOptionalDate, type JsonBody } from "@/lib/request"

// PATCH /api/spend-diary/[id]/entries/[entryId] — edit entry
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  const { id, entryId } = await params
  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  if (!await checkRateLimit(`spend-entry:${user.id}`, 60, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }
  const { title, amount, currency, date } = await req.json().catch(() => ({} as JsonBody))
  if (typeof title !== "string" || !title.trim() || title.length > 200 || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return Response.json({ error: "title and positive amount required" }, { status: 400 })
  }
  if (currency !== undefined && (typeof currency !== "string" || !CURRENCY_RE.test(currency))) {
    return Response.json({ error: "Invalid currency" }, { status: 400 })
  }
  const entryDate = parseOptionalDate(date)
  if (entryDate === undefined) return Response.json({ error: "Invalid date" }, { status: 400 })

  const owned = await prisma.spendEntry.findFirst({ where: { id: entryId, diaryId: id }, select: { id: true } })
  if (!owned) return Response.json({ error: "Not found" }, { status: 404 })

  const entry = await prisma.spendEntry.update({
    where: { id: entryId, diaryId: id },
    data: {
      title: title.trim(),
      amount: Math.round(amount * 100),
      currency: currency ?? "INR",
      date: entryDate ?? undefined,
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
  const locked = await requirePlus(user.id)
  if (locked) return locked

  const { id, entryId } = await params
  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  await prisma.spendEntry.deleteMany({ where: { id: entryId, diaryId: id } })
  return Response.json({ success: true })
}
