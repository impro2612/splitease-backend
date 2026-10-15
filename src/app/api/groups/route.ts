import { NextRequest, after } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSessionUser } from "@/lib/mobile-auth"
import { logActivity } from "@/lib/activity"
import { getNetPerPerson } from "@/lib/balance"
import { geocode } from "@/lib/geocode"
import { CURRENCY_RE, parseOptionalDate, readJson } from "@/lib/request"

// GET /api/groups — group cards. Returns the caller's net balance per currency
// (expenses AND settlements, computed server-side) instead of every expense with
// its splits, so the payload no longer grows with group history.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
      _count: { select: { expenses: true } },
    },
    orderBy: { updatedAt: "desc" },
  })
  const groupIds = groups.map((g) => g.id)
  const [expenses, settlements] = groupIds.length
    ? await Promise.all([
        prisma.expense.findMany({
          where: { groupId: { in: groupIds } },
          select: { groupId: true, currency: true, paidById: true, splits: { select: { userId: true, amount: true, paid: true } } },
        }),
        prisma.settlement.findMany({
          where: { groupId: { in: groupIds } },
          select: { groupId: true, currency: true, fromUserId: true, toUserId: true, amount: true },
        }),
      ])
    : [[], []]

  return Response.json(groups.map((g) => {
    const byCurrency = new Map<string, { exp: typeof expenses; set: typeof settlements }>()
    const bucket = (c: string) => {
      if (!byCurrency.has(c)) byCurrency.set(c, { exp: [], set: [] })
      return byCurrency.get(c)!
    }
    for (const e of expenses) if (e.groupId === g.id) bucket(e.currency ?? g.currency).exp.push(e)
    for (const s of settlements) if (s.groupId === g.id) bucket(s.currency ?? g.currency).set.push(s)

    const myBalance: Record<string, number> = {}
    for (const [currency, { exp, set }] of byCurrency) {
      const cents = getNetPerPerson(exp, set, true).get(user.id) ?? 0
      if (cents !== 0) myBalance[currency] = cents / 100 // + = others owe you, - = you owe
    }
    return { ...g, myBalance }
  }))
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { name, color, emoji, currency, location, lat: clientLat, lng: clientLng, startDate, endDate } = await readJson<{
      name: string; color: string; emoji: string; currency: string; location: string
      lat: number | null; lng: number | null; startDate: string; endDate: string
    }>(req)

    if (typeof name !== "string" || !name.trim()) return Response.json({ error: "Name is required" }, { status: 400 })
    if (name.trim().length > 100) return Response.json({ error: "Name is too long" }, { status: 400 })
    if (currency !== undefined && (typeof currency !== "string" || !CURRENCY_RE.test(currency))) {
      return Response.json({ error: "Invalid currency" }, { status: 400 })
    }
    const start = parseOptionalDate(startDate)
    const end = parseOptionalDate(endDate)
    if (start === undefined) return Response.json({ error: "Invalid startDate" }, { status: 400 })
    if (end === undefined) return Response.json({ error: "Invalid endDate" }, { status: 400 })
    if (start && end && start > end) return Response.json({ error: "endDate must be on or after startDate" }, { status: 400 })

    const place = typeof location === "string" && location.trim() ? location.trim() : null
    let lat = typeof clientLat === "number" && Number.isFinite(clientLat) ? clientLat : null
    let lng = typeof clientLng === "number" && Number.isFinite(clientLng) ? clientLng : null
    // only geocode if mobile didn't already send coordinates
    if (place && (lat === null || lng === null)) {
      const geo = await geocode(place)
      lat = geo?.lat ?? null
      lng = geo?.lng ?? null
    }

    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        color: color ?? "#6366f1",
        emoji: emoji ?? "💰",
        currency: currency ?? "USD",
        location: place,
        lat: place ? lat : null,
        lng: place ? lng : null,
        startDate: start,
        endDate: end,
        createdById: user.id,
        members: { create: { userId: user.id, role: "ADMIN" } },
      },
      include: { members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } } },
    })

    after(() => logActivity({
      type: "group_created",
      actorId: user.id,
      groupId: group.id,
      meta: { groupName: group.name, groupEmoji: group.emoji },
    }))

    return Response.json(group, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to create group" }, { status: 500 })
  }
}
