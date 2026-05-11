import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

function toApi(trip: any, actualSpent = 0, memberSpending: any[] = [], recentExpenses: any[] = []) {
  return {
    ...trip,
    totalBudget: trip.totalBudget / 100,
    actualSpent,
    categories: (trip.categories ?? []).map((c: any) => ({ ...c, amount: c.amount / 100 })),
    memberSpending,
    recentExpenses,
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
  let memberSpending: any[] = []
  let recentExpenses: any[] = []

  if (trip.groupId) {
    const expenses = await prisma.expense.findMany({
      where: { groupId: trip.groupId, date: { gte: trip.startDate, lte: trip.endDate } },
      include: { paidBy: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { date: "desc" },
    })

    actualSpent = expenses.reduce((s, e) => s + e.amount, 0)

    // Aggregate spending per member
    const memberMap = new Map<string, { user: any; paid: number }>()
    for (const e of expenses) {
      const existing = memberMap.get(e.paidById)
      if (existing) existing.paid += e.amount
      else memberMap.set(e.paidById, { user: e.paidBy, paid: e.amount })
    }
    memberSpending = Array.from(memberMap.values())
      .map((m) => ({ ...m, paid: m.paid / 100 }))
      .sort((a, b) => b.paid - a.paid)

    // Aggregate actual spend per category
    const categoryActual = new Map<string, number>()
    for (const e of expenses) {
      categoryActual.set(e.category, (categoryActual.get(e.category) ?? 0) + e.amount)
    }

    recentExpenses = expenses.slice(0, 30).map((e) => ({
      id: e.id,
      description: e.description,
      amount: e.amount / 100,
      category: e.category,
      date: e.date,
      paidBy: e.paidBy,
    }))

    // Attach actual amounts to categories
    trip.categories = trip.categories.map((c) => ({
      ...c,
      actualAmount: (categoryActual.get(c.category) ?? 0),
    })) as any

    actualSpent = actualSpent / 100
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

  const updated = await prisma.trip.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(emoji !== undefined && { emoji }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
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
  return Response.json({ ok: true })
}
