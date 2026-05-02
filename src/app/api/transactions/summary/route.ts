import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { CATEGORIES } from "@/lib/categorize"

// GET /api/transactions/summary?month=2026-04
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const month = searchParams.get("month") // "YYYY-MM", defaults to current month

  const now = new Date()
  const [y, m] = month
    ? month.split("-").map(Number)
    : [now.getFullYear(), now.getMonth() + 1]

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

  // Last 6 months trend
  const monthlyTrend: { month: string; income: number; expense: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    const ms = new Date(d.getFullYear(), d.getMonth(), 1)
    const me = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const txns = await prisma.personalTransaction.findMany({
      where: { userId: user.id, date: { gte: ms, lt: me } },
      select: { amount: true, type: true },
    })
    monthlyTrend.push({
      month: label,
      income: txns.filter((t) => t.type === "credit").reduce((s, t) => s + t.amount, 0) / 100,
      expense: txns.filter((t) => t.type === "debit").reduce((s, t) => s + t.amount, 0) / 100,
    })
  }

  return Response.json({
    month: `${y}-${String(m).padStart(2, "0")}`,
    totalIncome: totalIncome / 100,
    totalExpense: totalExpense / 100,
    netSavings: (totalIncome - totalExpense) / 100,
    transactionCount: transactions.length,
    categoryBreakdown,
    monthlyTrend,
  })
}
