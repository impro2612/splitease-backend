import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"

type TripWithDetails = Prisma.TripGetPayload<{
  include: {
    categories: true
    group: { select: { id: true; name: true; emoji: true; color: true } }
  }
}>

type UserInfo = { id: string; name: string | null; email: string; image: string | null }
type MemberSpend = { user: UserInfo; paid: number }
type RecentExpense = { id: string; description: string; amount: number; category: string; date: Date; paidBy: UserInfo }

function toApi(
  trip: TripWithDetails,
  actualSpent = 0,
  memberSpending: MemberSpend[] = [],
  recentExpenses: RecentExpense[] = [],
  categoryActuals: Record<string, number> = {}
) {
  return {
    ...trip,
    totalBudget: trip.totalBudget / 100,
    actualSpent,
    categories: trip.categories.map((c) => ({ ...c, amount: c.amount / 100 })),
    memberSpending,
    recentExpenses,
    categoryActuals,
  }
}

// GET /api/trips/[id] — trip detail with actual spending
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const trip = await prisma.trip.findFirst({
    where: { id, userId: user.id },
    include: {
      categories: true,
      group: { select: { id: true, name: true, emoji: true, color: true } },
    },
  })
  if (!trip) return Response.json({ error: "Not found" }, { status: 404 })

  let actualSpent = 0
  let memberSpending: MemberSpend[] = []
  let recentExpenses: RecentExpense[] = []

  if (trip.groupId) {
    const expenses = await prisma.expense.findMany({
      where: { groupId: trip.groupId, date: { gte: trip.startDate, lte: trip.endDate } },
      include: { paidBy: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { date: "desc" },
    })

    // Only sum expenses that match the trip's currency to avoid cross-currency nonsense
    const tripCurrencyExpenses = expenses.filter(
      (e) => ((e as { currency?: string }).currency ?? trip.currency) === trip.currency
    )
    actualSpent = tripCurrencyExpenses.reduce((s, e) => s + e.amount, 0)

    // Aggregate spending per member (same currency only)
    const memberMap = new Map<string, { user: UserInfo; paid: number }>()
    for (const e of tripCurrencyExpenses) {
      const existing = memberMap.get(e.paidById)
      if (existing) existing.paid += e.amount
      else memberMap.set(e.paidById, { user: e.paidBy, paid: e.amount })
    }
    memberSpending = Array.from(memberMap.values())
      .map((m) => ({ ...m, paid: m.paid / 100 }))
      .sort((a, b) => b.paid - a.paid)

    // Aggregate actual spend per category (same currency); map "utilities" → "general"
    const rawActual = new Map<string, number>()
    for (const e of tripCurrencyExpenses) {
      const key = e.category === "utilities" ? "general" : e.category
      rawActual.set(key, (rawActual.get(key) ?? 0) + e.amount)
    }

    // Convert to display units — all 8 trip categories always present
    const tripCategoryKeys = ["accommodation", "food", "transport", "entertainment", "shopping", "health", "travel", "general"]
    const categoryActuals: Record<string, number> = {}
    for (const key of tripCategoryKeys) {
      categoryActuals[key] = (rawActual.get(key) ?? 0) / 100
    }

    recentExpenses = tripCurrencyExpenses.slice(0, 30).map((e) => ({
      id: e.id,
      description: e.description,
      amount: e.amount / 100,
      category: e.category,
      date: e.date,
      paidBy: e.paidBy,
    }))

    actualSpent = actualSpent / 100
    return Response.json(toApi(trip, actualSpent, memberSpending, recentExpenses, categoryActuals))
  }

  return Response.json(toApi(trip, actualSpent, memberSpending, recentExpenses))
}

// PATCH /api/trips/[id] — update trip or upsert categories
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const trip = await prisma.trip.findFirst({ where: { id, userId: user.id } })
  if (!trip) return Response.json({ error: "Not found" }, { status: 404 })

  const { name, emoji, startDate, endDate, totalBudget, currency, status, groupId, categories } = await req.json()

  if (groupId) {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    })
    if (!member) return Response.json({ error: "Not a member of this group" }, { status: 403 })
  }

  if (totalBudget !== undefined && (typeof totalBudget !== "number" || !Number.isFinite(totalBudget) || totalBudget <= 0)) {
    return Response.json({ error: "totalBudget must be a positive finite number" }, { status: 400 })
  }
  const patchedStart = startDate !== undefined ? new Date(startDate) : trip.startDate
  const patchedEnd   = endDate   !== undefined ? new Date(endDate)   : trip.endDate
  if (startDate !== undefined && isNaN(patchedStart.getTime())) {
    return Response.json({ error: "Invalid startDate" }, { status: 400 })
  }
  if (endDate !== undefined && isNaN(patchedEnd.getTime())) {
    return Response.json({ error: "Invalid endDate" }, { status: 400 })
  }
  if (patchedEnd < patchedStart) {
    return Response.json({ error: "endDate must be on or after startDate" }, { status: 400 })
  }

  const updated = await prisma.trip.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(emoji !== undefined && { emoji }),
      ...(startDate !== undefined && { startDate: patchedStart }),
      ...(endDate !== undefined && { endDate: patchedEnd }),
      ...(totalBudget !== undefined && { totalBudget: Math.round(totalBudget * 100) }),
      ...(currency !== undefined && { currency }),
      ...(status !== undefined && { status }),
      ...(groupId !== undefined && { groupId: groupId ?? null }),
      updatedAt: new Date(),
    },
    include: {
      categories: true,
      group: { select: { id: true, name: true, emoji: true, color: true } },
    },
  })

  if (categories?.length) {
    const effectiveBudget = totalBudget !== undefined ? Math.round(totalBudget * 100) : updated.totalBudget
    const existingCats = await prisma.tripCategoryBudget.findMany({ where: { tripId: id } })
    const catMap = new Map(existingCats.map((c) => [c.category, c.amount]))
    for (const c of categories) {
      catMap.set(c.category, Math.round(c.amount * 100))
    }
    const totalAllocated = Array.from(catMap.values()).reduce((s, a) => s + a, 0)
    if (totalAllocated > effectiveBudget) {
      return Response.json(
        { error: `Category budgets (${totalAllocated / 100}) exceed total trip budget (${effectiveBudget / 100})` },
        { status: 400 }
      )
    }
    for (const c of categories) {
      await prisma.tripCategoryBudget.upsert({
        where: { tripId_category: { tripId: id, category: c.category } },
        update: { amount: Math.round(c.amount * 100) },
        create: { tripId: id, category: c.category, amount: Math.round(c.amount * 100) },
      })
    }
  }

  return Response.json(toApi(updated))
}

// DELETE /api/trips/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const trip = await prisma.trip.findFirst({ where: { id, userId: user.id } })
  if (!trip) return Response.json({ error: "Not found" }, { status: 404 })

  await prisma.trip.delete({ where: { id } })
  return Response.json({ ok: true }, { status: 200 })
}
