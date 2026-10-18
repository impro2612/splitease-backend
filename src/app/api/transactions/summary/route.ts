import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { CATEGORIES } from "@/lib/categorize"
import { currentMonth, monthKey, parseMonth } from "@/lib/month"

// GET /api/transactions/summary?month=2026-04
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  const { searchParams } = new URL(req.url)
  const month = searchParams.get("month") // "YYYY-MM", defaults to current month

  const parsed = month ? parseMonth(month) : currentMonth()
  if (!parsed) return Response.json({ error: "month must be YYYY-MM" }, { status: 400 })
  const { y, m } = parsed

  const start = new Date(y, m - 1, 1)
  const end   = new Date(y, m, 1)

  const transactions = await prisma.personalTransaction.findMany({
    where: { userId: user.id, date: { gte: start, lt: end } },
    select: { amount: true, type: true, category: true, date: true },
  })

  let totalIncome = 0
  let totalExpense = 0
  const byCat: Record<string, number> = {}
  const byDay: Record<string, number> = {}

  for (const t of transactions) {
    if (t.type === "credit") {
      totalIncome += t.amount
    } else {
      totalExpense += t.amount
      byCat[t.category] = (byCat[t.category] ?? 0) + t.amount
      const day = t.date.toISOString().split("T")[0]
      byDay[day] = (byDay[day] ?? 0) + t.amount
    }
  }

  // Category breakdown sorted by spend
  const categoryBreakdown = CATEGORIES
    .filter((c) => c !== "Salary / Income")
    .map((c) => ({ category: c, amount: (byCat[c] ?? 0) / 100 }))
    .sort((a, b) => b.amount - a.amount)

  // Last 6 months trend — one query for the whole window instead of six
  const trendStart = new Date(y, m - 6, 1)
  const trendTxns = await prisma.personalTransaction.findMany({
    where: { userId: user.id, date: { gte: trendStart, lt: end } },
    select: { amount: true, type: true, date: true },
  })
  const monthlyTrend: { month: string; income: number; expense: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    const label = monthKey(d.getFullYear(), d.getMonth() + 1)
    monthlyTrend.push({ month: label, income: 0, expense: 0 })
  }
  const byLabel = new Map(monthlyTrend.map((t) => [t.month, t]))
  for (const t of trendTxns) {
    const bucket = byLabel.get(monthKey(t.date.getFullYear(), t.date.getMonth() + 1))
    if (!bucket) continue
    if (t.type === "credit") bucket.income += t.amount
    else if (t.type === "debit") bucket.expense += t.amount
  }
  for (const t of monthlyTrend) { t.income /= 100; t.expense /= 100 }

  return Response.json({
    month: monthKey(y, m),
    totalIncome: totalIncome / 100,
    totalExpense: totalExpense / 100,
    netSavings: (totalIncome - totalExpense) / 100,
    transactionCount: transactions.length,
    categoryBreakdown,
    monthlyTrend,
  })
}
