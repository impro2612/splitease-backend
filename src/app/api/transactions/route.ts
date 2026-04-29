import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

function txToApi(t: { amount: number; [key: string]: unknown }) {
  return { ...t, amount: t.amount / 100 }
}

// GET /api/transactions?month=2026-04&category=Food&type=debit&page=1
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const month    = searchParams.get("month")    // "YYYY-MM"
  const category = searchParams.get("category")
  const type     = searchParams.get("type")
  const page     = parseInt(searchParams.get("page") ?? "1")
  const limit    = 50

  const where: Record<string, unknown> = { userId: user.id }

  if (month) {
    const [y, m] = month.split("-").map(Number)
    where.date = {
      gte: new Date(y, m - 1, 1),
      lt:  new Date(y, m, 1),
    }
  }
  if (category) where.category = category
  if (type)     where.type = type

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
