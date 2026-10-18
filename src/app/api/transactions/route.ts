import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { parseMonth } from "@/lib/month"
import { CATEGORIES } from "@/lib/categorize"

function txToApi(t: { amount: number; [key: string]: unknown }) {
  return { ...t, amount: t.amount / 100 }
}

// GET /api/transactions?month=2026-04&category=Food&type=debit&page=1
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  const { searchParams } = new URL(req.url)
  const month    = searchParams.get("month")    // "YYYY-MM"
  const category = searchParams.get("category")
  const type     = searchParams.get("type")
  const page     = Math.min(Math.max(parseInt(searchParams.get("page") ?? "1") || 1, 1), 1000)
  const limit    = 50

  const where: Record<string, unknown> = { userId: user.id }

  if (month) {
    const parsed = parseMonth(month)
    if (!parsed) return Response.json({ error: "month must be YYYY-MM" }, { status: 400 })
    const { y, m } = parsed
    where.date = {
      gte: new Date(y, m - 1, 1),
      lt:  new Date(y, m, 1),
    }
  }
  if (category) {
    if (!(CATEGORIES as readonly string[]).includes(category)) return Response.json({ error: "Invalid category" }, { status: 400 })
    where.category = category
  }
  if (type) {
    if (type !== "debit" && type !== "credit") return Response.json({ error: "Invalid type" }, { status: 400 })
    where.type = type
  }

  const [transactions, total] = await Promise.all([
    prisma.personalTransaction.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.personalTransaction.count({ where }),
  ])

  return Response.json({
    transactions: transactions.map(txToApi),
    total,
    page,
    pages: Math.ceil(total / limit),
  })
}
