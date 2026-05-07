import { GoogleGenerativeAI } from "@google/generative-ai"
import { prisma } from "@/lib/prisma"

type MonthStats = {
  analyzedMonth: string
  title: string
  summary: string
  recommendations: string[]
  source: "gemini" | "built"
}

const PERSONISH_CATEGORY_SET = new Set(["UPI Payments", "Transfers"])
const DISCRETIONARY_CATEGORY_SET = new Set([
  "Food / Dining",
  "Shopping",
  "Travel",
  "Transport",
  "Subscriptions",
  "UPI Payments",
  "Miscellaneous",
])
const ESSENTIAL_CATEGORY_SET = new Set([
  "Bills / Utilities",
  "EMI / Loans",
  "Medical / Pharmacy",
  "Bank Charges",
])
const GENERIC_LABEL_SET = new Set([
  "this spend",
  "upi payment",
  "payments",
  "payment",
  "transfer",
  "upi",
  "merchant",
  "expense",
  "spend",
])

function monthTitle(month: string) {
  const [year, mon] = month.split("-").map(Number)
  return new Date(year, mon - 1, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  })
}

function cleanSuggestionLabel(input: string) {
  return input
    .replace(/\bUPI[-\s]*/gi, "")
    .replace(/\b(?:NEFT|IMPS|RTGS|ACH|NACH|ECS)\b[-\s]*/gi, "")
    .replace(/\bNO REMARKS\b/gi, "")
    .replace(/\bUPIINTENT\b/gi, "")
    .replace(/@[\w.-]+/g, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function titleCase(input: string) {
  return input
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function humanizeSuggestionLabel(input: string) {
  const cleaned = cleanSuggestionLabel(input)
  if (!cleaned) return "this spend"

  const compact = cleaned.replace(/\s+/g, " ").trim()
  if (compact.length <= 2) return "this spend"

  const named = titleCase(compact)
  return named.length > 48 ? `${named.slice(0, 45).trim()}...` : named
}

function normalizeRecurringKey(input: string) {
  return cleanSuggestionLabel(input)
    .toLowerCase()
    .replace(/\b(?:payment|payments|upi|intent|remarks|merchant|paytm|yesb0ptmu|yesboyblupi|blupi)\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function looksLikePersonName(input: string) {
  const cleaned = cleanSuggestionLabel(input)
  if (!cleaned) return false
  const parts = cleaned
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean)

  if (parts.length < 2 || parts.length > 4) return false

  return parts.every((part) => /^[A-Za-z]{3,}$/.test(part))
}

function isUsefulMerchantLabel(input: string) {
  const cleaned = humanizeSuggestionLabel(input).toLowerCase()
  if (!cleaned || GENERIC_LABEL_SET.has(cleaned)) return false
  if (cleaned.length < 4) return false
  return true
}

function roundActionAmount(amount: number) {
  if (amount <= 0) return 0
  if (amount < 1000) return Math.round(amount / 100) * 100
  return Math.round(amount / 500) * 500
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.round(value))}%`
}

function rupees(amount: number) {
  return `₹${amount.toFixed(0)}`
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
  const savingsRate = input.income > 0 ? (input.savings / input.income) * 100 : 0
  const topShare = top && input.expense > 0 ? (top.amount / input.expense) * 100 : 0
  const topDiscretionary = input.topCategories.find((item) => DISCRETIONARY_CATEGORY_SET.has(item.category))
  const essentialSpend = input.topCategories
    .filter((item) => ESSENTIAL_CATEGORY_SET.has(item.category))
    .reduce((sum, item) => sum + item.amount, 0)

  if (top) {
    if (top.category === "Credit Card Payments") {
      recommendations.push(
        `Credit card payments were your biggest outgoing at ${rupees(top.amount)}. Review the card purchases behind this bill first, because cutting new card spending will help reduce the next payment cycle.`
      )
    } else if (top.category === "UPI Payments") {
      recommendations.push(
        `UPI payments took ${rupees(top.amount)} in ${title}. Go through these first and separate essential transfers from impulse or convenience spends so you can set a tighter weekly transfer limit.`
      )
    } else if (topShare >= 30) {
      const cap = roundActionAmount(top.amount * 0.85)
      recommendations.push(
        `${top.category} alone took about ${formatPercent(topShare)} of your monthly spend in ${title}. Set yourself a cap of around ${rupees(cap)} next month so this one category does not dominate your budget.`
      )
    } else {
      recommendations.push(
        `${top.category} was your biggest expense area at ${rupees(top.amount)}. Review this category first because it offers the fastest chance to free up money without changing everything else.`
      )
    }
  }

  if (second && top && top.amount > 0) {
    const gap = Math.round(top.amount - second.amount)
    if (gap > 0) {
      recommendations.push(
        `${top.category} is ahead of ${second.category} by about ${rupees(gap)}. Start reducing ${top.category} before touching smaller categories because that is where the biggest savings are.`
      )
    }
  }

  if (input.recurring.length > 0) {
    const leak = input.recurring[0]
    recommendations.push(
      `${humanizeSuggestionLabel(leak.description)} showed up ${leak.count} times and cost ${rupees(leak.total)} in total. Check if this is truly essential, and if not, cap it or replace it with a cheaper option.`
    )
  }

  if (input.highestDay) {
    recommendations.push(
      `Your highest spending day was ${new Date(input.highestDay.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} with about ${rupees(input.highestDay.amount)} spent. Review that day to spot one-off spikes, bulk payments, or impulse purchases that can be planned better next time.`
    )
  }

  if (input.savings < 0) {
    const deficit = roundActionAmount(Math.abs(input.savings))
    recommendations.push(
      `You spent more than you earned in ${title}. Your first goal next month should be to cut at least ${rupees(deficit)} from non-essential spending so you get back to positive savings.`
    )
  } else if (input.income > 0) {
    const autoSave = roundActionAmount(Math.max(input.savings * 0.4, input.income * 0.1))
    recommendations.push(
      `You saved ${rupees(input.savings)} in ${title}, which is about ${formatPercent(savingsRate)} of income. Move around ${rupees(autoSave)} automatically into savings or investments as soon as income arrives so that money does not get spent casually later.`
    )
  } else {
    recommendations.push(
      `Your expenses were ${rupees(input.expense)} in ${title}. Set one clear category limit for next month and track against it weekly so you can measure improvement.`
    )
  }

  if (topDiscretionary && topDiscretionary.amount >= 2000) {
    const targetCut = Math.max(500, Math.round(topDiscretionary.amount * 0.1))
    recommendations.push(
      `A practical target for next month is to reduce ${topDiscretionary.category} by about ${rupees(targetCut)}. That one change would improve your savings without needing a major lifestyle shift.`
    )
  }

  if (input.income > 0 && input.expense > 0 && essentialSpend < input.expense * 0.5) {
    recommendations.push(
      `A large share of your spending is outside fixed essentials. That is good news because it means you likely have room to cut discretionary spends faster than someone locked into fixed bills.`
    )
  }

  if (recommendations.length === 0) {
    recommendations.push("Keep tracking your expenses consistently. A complete month of clean statement data helps generate much sharper savings advice.")
  }

  return {
    analyzedMonth: input.month,
    title,
    source: "built",
    summary:
      input.income > 0
        ? `In ${title}, you spent ${rupees(input.expense)} against income of ${rupees(input.income)}, leaving ${input.savings >= 0 ? "savings" : "a shortfall"} of ${rupees(Math.abs(input.savings))}. The biggest improvement opportunity is in your top spending buckets and repeat discretionary transactions.`
        : `In ${title}, you spent ${rupees(input.expense)}. The best next step is to control your biggest categories and trim repeated non-essential spends.`,
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
      if (PERSONISH_CATEGORY_SET.has(txn.category) && looksLikePersonName(txn.description)) {
        return acc
      }

      const cleaned = normalizeRecurringKey(txn.description)
      if (!cleaned || cleaned.length < 4) return acc
      if (PERSONISH_CATEGORY_SET.has(txn.category) && !isUsefulMerchantLabel(cleaned)) return acc

      const key = cleaned
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
- Be clear, simple, and non-technical
- Focus on actionable advice, not just a summary of totals
- Highlight opportunities to save money
- Point out exactly where spending can be reduced
- Suggest how to optimize savings next month
- Mention financial habits that should be improved
- Use the category names and repeated merchant names intelligently
- Handle messy or inconsistent transaction descriptions intelligently and simplify them before mentioning them
- Avoid generic advice that does not connect to the data
- Do not over-focus on person-to-person transfers unless they are repeated and material
- You may add one or two more important observations if useful
- Keep recommendations concrete, friendly, and specific to the data
- Do not use markdown, numbering, or bullets inside strings
- Maximum 6 recommendations

Monthly data:
- Month: ${fallback.title}
- Income: ₹${income.toFixed(0)}
- Expense: ₹${expense.toFixed(0)}
- Savings: ₹${savings.toFixed(0)}
- Savings rate: ${formatPercent(income > 0 ? (savings / income) * 100 : 0)}
- Top expense categories: ${topCategories.map((item) => `${item.category} ₹${item.amount.toFixed(0)}`).join(", ") || "none"}
- Recurring spends: ${recurring.map((item) => `${humanizeSuggestionLabel(item.description)} ×${item.count} = ₹${item.total.toFixed(0)}`).join(", ") || "none"}
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
      source: "gemini",
      summary: String(parsed.summary || fallback.summary).trim(),
      recommendations: recommendations.length > 0 ? recommendations : fallback.recommendations,
    }
  } catch (err) {
    console.error("Suggestion generation error:", err)
    return fallback
  }
}
