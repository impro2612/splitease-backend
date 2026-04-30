import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenerativeAI } from "@google/generative-ai"

// GET /api/transactions/insights?month=2026-04
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const month = searchParams.get("month")
  const now = new Date()
  const [y, m] = month
    ? month.split("-").map(Number)
    : [now.getFullYear(), now.getMonth() + 1]

  const start = new Date(y, m - 1, 1)
  const end   = new Date(y, m, 1)
  const prevStart = new Date(y, m - 2, 1)

  const [txns, prevTxns, budgets] = await Promise.all([
    prisma.personalTransaction.findMany({
      where: { userId: user.id, date: { gte: start, lt: end } },
      select: { amount: true, type: true, category: true, description: true, date: true },
    }),
    prisma.personalTransaction.findMany({
      where: { userId: user.id, date: { gte: prevStart, lt: start } },
      select: { amount: true, type: true, category: true },
    }),
    prisma.personalBudget.findMany({ where: { userId: user.id } }),
  ])

  if (txns.length === 0) {
    return Response.json({
      insights: [],
      aiSummary: "No transactions found for this month. Connect Gmail or upload a statement to get started.",
      spendingLeaks: [],
      budgetAlerts: [],
    })
  }

  // Build stats
  const debits = txns.filter((t) => t.type === "debit")
  const totalExpense = debits.reduce((s, t) => s + t.amount, 0)
  const totalIncome  = txns.filter((t) => t.type === "credit").reduce((s, t) => s + t.amount, 0)

  const byCat: Record<string, number> = {}
  for (const t of debits) byCat[t.category] = (byCat[t.category] ?? 0) + t.amount

  const prevByCat: Record<string, number> = {}
  for (const t of prevTxns.filter((t) => t.type === "debit"))
    prevByCat[t.category] = (prevByCat[t.category] ?? 0) + t.amount

  // Spending leaks: descriptions appearing 4+ times
  const descCount: Record<string, { count: number; total: number }> = {}
  for (const t of debits) {
    if (!descCount[t.description]) descCount[t.description] = { count: 0, total: 0 }
    descCount[t.description].count++
    descCount[t.description].total += t.amount
  }
  const spendingLeaks = Object.entries(descCount)
    .filter(([, v]) => v.count >= 4)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([desc, v]) => ({ description: desc, count: v.count, total: v.total / 100 }))

  // Budget alerts
  const budgetAlerts = budgets
    .filter((b) => (byCat[b.category] ?? 0) > b.amount)
    .map((b) => ({
      category: b.category,
      budget: b.amount / 100,
      spent: (byCat[b.category] ?? 0) / 100,
      overspent: ((byCat[b.category] ?? 0) - b.amount) / 100,
    }))

  // Top categories
  const topCategories = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, amt]) => {
      const prev = prevByCat[cat] ?? 0
      const change = prev > 0 ? Math.round(((amt - prev) / prev) * 100) : null
      return { category: cat, amount: amt / 100, changePercent: change }
    })

  // AI summary
  let aiSummary = ""
  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
      })

      const prompt = `Personal finance advisor for Indian user. 2-3 short actionable sentences, no bullet points, use ₹.
Month:${y}-${String(m).padStart(2,"0")} Income:₹${(totalIncome/100).toFixed(0)} Expense:₹${(totalExpense/100).toFixed(0)}
Top:${topCategories.map((c)=>`${c.category}₹${c.amount.toFixed(0)}`).join(",")}
Leaks:${spendingLeaks.map((l)=>`${l.description}×${l.count}=₹${l.total.toFixed(0)}`).join(",")||"none"}
Alerts:${budgetAlerts.map((a)=>`${a.category}+₹${a.overspent.toFixed(0)}`).join(",")||"none"}`

      const result = await model.generateContent(prompt)
      aiSummary = result.response.text().trim()
    } catch { aiSummary = "" }
  }

  return Response.json({
    topCategories,
    spendingLeaks,
    budgetAlerts,
    aiSummary,
    highSpendDays: Object.entries(
      debits.reduce((acc: Record<string, number>, t) => {
        const day = t.date.toISOString().split("T")[0]
        acc[day] = (acc[day] ?? 0) + t.amount
        return acc
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([day, amt]) => ({ day, amount: amt / 100 })),
  })
}
