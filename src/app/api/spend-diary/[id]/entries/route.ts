import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { CURRENCY_RE, parseOptionalDate, type JsonBody } from "@/lib/request"

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

  const entry = await prisma.spendEntry.create({
    data: {
      diaryId: id,
      title: title.trim(),
      amount: Math.round(amount * 100),
      currency: currency ?? "INR",
      date: entryDate ?? new Date(),
    },
  })

  await prisma.spendDiary.update({ where: { id }, data: { updatedAt: new Date() } })

  return Response.json({ ...entry, amount: entry.amount / 100 }, { status: 201 })
}
