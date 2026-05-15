import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSessionUser } from "@/lib/mobile-auth"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const yearParam = url.searchParams.get("year")

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    select: {
      id: true, name: true, emoji: true, location: true, startDate: true, endDate: true,
      members: { select: { user: { select: { id: true, name: true } } } },
      expenses: {
        select: {
          id: true, amount: true, category: true, date: true,
          paidById: true,
          paidBy: { select: { id: true, name: true } },
          splits: { select: { userId: true, amount: true, paid: true } },
        },
        orderBy: { date: "asc" },
      },
      settlements: {
        select: { fromUserId: true, toUserId: true, amount: true },
      },
    },
  })

  // Derive available years from all expense dates
  const allYears = groups.flatMap(g => g.expenses.map(e => new Date(e.date).getFullYear()))
  const availableYears = [...new Set(allYears)].sort((a, b) => b - a)
  const targetYear = yearParam ? parseInt(yearParam) : (availableYears[0] ?? new Date().getFullYear())

  const yearGroups = groups
    .map(g => ({ ...g, expenses: g.expenses.filter(e => new Date(e.date).getFullYear() === targetYear) }))
    .filter(g => g.expenses.length > 0)

  if (yearGroups.length === 0) {
    return Response.json({ year: targetYear, availableYears, empty: true })
  }

  // Total groups active this year
  const totalGroups = yearGroups.length

  // Unique locations
  const locations = [...new Set(yearGroups.map(g => g.location).filter(Boolean))] as string[]

  // Wildest trip (group with highest total expense sum)
  let wildestTrip: { name: string; emoji: string; total: number; members: number; days: number | null; location: string | null } | null = null
  yearGroups.forEach(g => {
    const total = g.expenses.reduce((s, e) => s + e.amount, 0)
    if (!wildestTrip || total > wildestTrip.total) {
      let days: number | null = null
      if (g.startDate && g.endDate) {
        days = Math.max(1, Math.ceil((new Date(g.endDate).getTime() - new Date(g.startDate).getTime()) / 86400000) + 1)
      } else if (g.expenses.length > 1) {
        const first = new Date(g.expenses[0].date).getTime()
        const last = new Date(g.expenses[g.expenses.length - 1].date).getTime()
        days = Math.max(1, Math.ceil((last - first) / 86400000) + 1)
      }
      wildestTrip = { name: g.name, emoji: g.emoji, total, members: g.members.length, days, location: g.location ?? null }
    }
  })

  // Top category by total spend
  const catTotals: Record<string, number> = {}
  let grandTotal = 0
  yearGroups.forEach(g => g.expenses.forEach(e => {
    catTotals[e.category] = (catTotals[e.category] ?? 0) + e.amount
    grandTotal += e.amount
  }))
  const topCatEntry = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0]
  const topCategory = topCatEntry
    ? { name: topCatEntry[0], total: topCatEntry[1], pct: Math.round((topCatEntry[1] / grandTotal) * 100) }
    : null

  // Most generous (member who paid most times)
  const paidMap: Record<string, { name: string; count: number; total: number }> = {}
  yearGroups.forEach(g => g.expenses.forEach(e => {
    if (!paidMap[e.paidById]) paidMap[e.paidById] = { name: e.paidBy.name, count: 0, total: 0 }
    paidMap[e.paidById].count++
    paidMap[e.paidById].total += e.amount
  }))
  const mostGenerous = Object.values(paidMap).sort((a, b) => b.total - a.total)[0] ?? null

  // Net balance: positive = others owe user, negative = user owes others
  let owedToUser = 0
  let userOwes = 0
  yearGroups.forEach(g => {
    g.expenses.forEach(e => {
      if (e.paidById === user.id) {
        e.splits.forEach(s => { if (s.userId !== user.id && !s.paid) owedToUser += s.amount })
      } else {
        const split = e.splits.find(s => s.userId === user.id)
        if (split && !split.paid) userOwes += split.amount
      }
    })
    g.settlements.forEach(s => {
      if (s.fromUserId === user.id) userOwes = Math.max(0, userOwes - s.amount)
      if (s.toUserId === user.id) owedToUser = Math.max(0, owedToUser - s.amount)
    })
  })

  return Response.json({
    year: targetYear,
    availableYears,
    empty: false,
    totalGroups,
    totalSpent: grandTotal,   // cents
    locations,
    wildestTrip,
    topCategory,
    mostGenerous,
    owedToUser,               // cents
    userOwes,                 // cents
  })
}
