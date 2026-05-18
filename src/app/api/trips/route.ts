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

function toApi(trip: TripWithDetails, actualSpent = 0) {
  return {
    ...trip,
    totalBudget: trip.totalBudget / 100,
    actualSpent,
    categories: trip.categories.map((c) => ({ ...c, amount: c.amount / 100 })),
  }
}

// GET /api/trips — list all trips for user
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const trips = await prisma.trip.findMany({
    where: { userId: user.id },
    include: {
      categories: true,
      group: { select: { id: true, name: true, emoji: true, color: true } },
    },
    orderBy: { startDate: "asc" },
  })

  const groupIds = trips.map((t) => t.groupId).filter(Boolean) as string[]
  const allExpenses = groupIds.length > 0
    ? await prisma.expense.findMany({
        where: { groupId: { in: groupIds } },
        select: { amount: true, currency: true, groupId: true, date: true },
      })
    : []

  const expensesByGroup = new Map<string, typeof allExpenses>()
  for (const e of allExpenses) {
    const list = expensesByGroup.get(e.groupId) ?? []
    list.push(e)
    expensesByGroup.set(e.groupId, list)
  }

  const result = trips.map((trip) => {
    let actualSpent = 0
    if (trip.groupId) {
      const expenses = expensesByGroup.get(trip.groupId) ?? []
      actualSpent = expenses
        .filter(
          (e) =>
            e.date >= trip.startDate &&
            e.date <= trip.endDate &&
            (e.currency ?? trip.currency) === trip.currency
        )
        .reduce((s, e) => s + e.amount, 0) / 100
    }
    return toApi(trip, actualSpent)
  })

  return Response.json(result)
}

// POST /api/trips — create trip
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { name, emoji, startDate, endDate, totalBudget, currency, groupId, categories } = await req.json()

  if (!name || !startDate || !endDate || !totalBudget) {
    return Response.json({ error: "name, startDate, endDate and totalBudget required" }, { status: 400 })
  }
  if (typeof totalBudget !== "number" || !Number.isFinite(totalBudget) || totalBudget <= 0) {
    return Response.json({ error: "totalBudget must be a positive finite number" }, { status: 400 })
  }
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json({ error: "Invalid date values" }, { status: 400 })
  }
  if (end < start) {
    return Response.json({ error: "endDate must be on or after startDate" }, { status: 400 })
  }
  if (categories?.length) {
    const catTotal = (categories as { category: string; amount: number }[])
      .reduce((s, c) => s + (c.amount ?? 0), 0)
    if (!Number.isFinite(catTotal) || catTotal > totalBudget) {
      return Response.json({ error: "Category amounts must be finite and must not exceed totalBudget" }, { status: 400 })
    }
  }

  if (groupId) {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    })
    if (!member) return Response.json({ error: "Not a member of this group" }, { status: 403 })
  }

  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name,
      emoji: emoji ?? "✈️",
      startDate: start,
      endDate: end,
      totalBudget: Math.round(totalBudget * 100),
      currency: currency ?? "INR",
      groupId: groupId ?? null,
      updatedAt: new Date(),
      ...(categories?.length && {
        categories: {
          create: categories.map((c: { category: string; amount: number }) => ({
            category: c.category,
            amount: Math.round(c.amount * 100),
          })),
        },
      }),
    },
    include: {
      categories: true,
      group: { select: { id: true, name: true, emoji: true, color: true } },
    },
  })

  return Response.json(toApi(trip), { status: 201 })
}
