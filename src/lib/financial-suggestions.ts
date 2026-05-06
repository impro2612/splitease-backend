import { GoogleGenerativeAI } from "@google/generative-ai"
import { prisma } from "@/lib/prisma"

type MonthStats = {
  analyzedMonth: string
  title: string
  summary: string
  recommendations: string[]
}

function monthTitle(month: string) {
  const [year, mon] = month.split("-").map(Number)
  return new Date(year, mon - 1, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  })
}

function buildFallbackSuggestions(input: {
  month: string
  income: number
  expense: number
  savings: number
  topCategories: Array<{ category: string; amount: number }>
  recurring: Array<{ description: string; count: number; total: number }>
  highestDay?: { day: string; amount: number } | null
}): MonthStats {
  const title = monthTitle(input.month)
  const recommendations: string[] = []
  const top = input.topCategories[0]
  const second = input.topCategories[1]

  if (top) {
    recommendations.push(
      `${top.category} was your highest expense bucket in ${title} at ₹${top.amount.toFixed(0)}. Review this category first for the easiest savings opportunity.`
    )
  }

  if (second && top && top.amount > 0) {
    const gap = Math.round(top.amount - second.amount)
    if (gap > 0) {
      recommendations.push(
        `${top.category} is ahead of ${second.category} by about ₹${gap}. A small cut here will have more impact than trimming lower categories.`
      )
    }
  }

  if (input.recurring.length > 0) {
    const leak = input.recurring[0]
    recommendations.push(
      `${leak.description} appeared ${leak.count} times and added up to ₹${leak.total.toFixed(0)}. Check if this is a habit expense you can cap or batch.`
    )
  }

  if (input.highestDay) {
    recommendations.push(
      `Your highest spending day was ${new Date(input.highestDay.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} with about ₹${input.highestDay.amount.toFixed(0)} spent. Large one-day spikes are worth reviewing.`
    )
  }

  if (input.savings < 0) {
    recommendations.push(
      `You spent more than you earned in ${title}. Focus on reducing discretionary spending and delaying non-essential purchases next month.`
    )
  } else {
    recommendations.push(
      `You saved about ₹${input.savings.toFixed(0)} in ${title}. Try moving a fixed part of that amount into savings or investments as soon as income arrives.`
    )
  }

  if (recommendations.length === 0) {
    recommendations.push("Keep tracking your expenses consistently. A complete statement history makes future recommendations much sharper.")
  }

  return {
    analyzedMonth: input.month,
    title,
    summary: `Here’s your financial advisor summary for ${title}. Focus on the biggest expense buckets, recurring habits, and how much you were able to save after spending.`,
    recommendations: recommendations.slice(0, 6),
  }
}

export async function generateSuggestionsForMonth(userId: string, month: string): Promise<MonthStats | null> {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return null

  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 1)

  const txns = await prisma.personalTransaction.findMany({
    where: { userId, date: { gte: start, lt: end } },
    select: { amount: true, type: true, category: true, description: true, date: true },
  })

  if (txns.length === 0) return null

  const debits = txns.filter((t) => t.type === "debit")
  const credits = txns.filter((t) => t.type === "credit")
  const expense = debits.reduce((sum, t) => sum + t.amount, 0) / 100
  const income = credits.reduce((sum, t) => sum + t.amount, 0) / 100
  const savings = income - expense

  const byCategory = debits.reduce<Record<string, number>>((acc, txn) => {
    acc[txn.category] = (acc[txn.category] ?? 0) + txn.amount
    return acc
  }, {})

  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([category, amount]) => ({ category, amount: amount / 100 }))

  const recurring = Object.entries(
    debits.reduce<Record<string, { count: number; total: number }>>((acc, txn) => {
      const key = txn.description
      const current = acc[key] ?? { count: 0, total: 0 }
      current.count += 1
      current.total += txn.amount
      acc[key] = current
      return acc
    }, {})
  )
    .filter(([, value]) => value.count >= 2)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 4)
    .map(([description, value]) => ({
      description,
      count: value.count,
      total: value.total / 100,
    }))

  const highestDayEntries = Object.entries(
    debits.reduce<Record<string, number>>((acc, txn) => {
      const day = txn.date.toISOString().slice(0, 10)
      acc[day] = (acc[day] ?? 0) + txn.amount
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1])

  const highestDay = highestDayEntries[0]
    ? { day: highestDayEntries[0][0], amount: highestDayEntries[0][1] / 100 }
    : null

  const fallback = buildFallbackSuggestions({
    month,
    income,
    expense,
    savings,
    topCategories,
    recurring,
    highestDay,
  })

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) return fallback

  try {
    const genAI = new GoogleGenerativeAI(geminiKey)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      generationConfig: { maxOutputTokens: 900, temperature: 0.25 },
    })

    const prompt = `
You are a practical personal financial advisor.

Study this user's monthly expense report for ${fallback.title}. Return ONLY valid JSON:
{
  "summary": "2-3 sentence overview in plain English",
  "recommendations": [
    "Actionable recommendation 1",
    "Actionable recommendation 2",
    "Actionable recommendation 3",
    "Actionable recommendation 4"
  ]
}

Rules:
- Focus on opportunities to save money
- Highlight where to reduce spending
- Suggest how to optimize savings
- Point out financial habits to improve
- You may add one or two more important observations if useful
- Keep recommendations concrete, friendly, and specific to the data
- Do not use markdown, numbering, or bullets inside strings
- Maximum 6 recommendations

Monthly data:
- Month: ${fallback.title}
- Income: ₹${income.toFixed(0)}
- Expense: ₹${expense.toFixed(0)}
- Savings: ₹${savings.toFixed(0)}
- Top expense categories: ${topCategories.map((item) => `${item.category} ₹${item.amount.toFixed(0)}`).join(", ") || "none"}
- Recurring spends: ${recurring.map((item) => `${item.description} ×${item.count} = ₹${item.total.toFixed(0)}`).join(", ") || "none"}
- Highest spend day: ${highestDay ? `${highestDay.day} ₹${highestDay.amount.toFixed(0)}` : "none"}
`.trim()

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return fallback
    const parsed = JSON.parse(match[0]) as { summary?: string; recommendations?: string[] }

    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 6)
      : fallback.recommendations

    return {
      analyzedMonth: month,
      title: fallback.title,
      summary: String(parsed.summary || fallback.summary).trim(),
      recommendations: recommendations.length > 0 ? recommendations : fallback.recommendations,
    }
  } catch (err) {
    console.error("Suggestion generation error:", err)
    return fallback
  }
}
