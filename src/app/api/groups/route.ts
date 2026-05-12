import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSessionUser } from "@/lib/mobile-auth"
import { logActivity } from "@/lib/activity"

type ExpenseRow = { amount: number; splits?: { amount: number }[] } & Record<string, unknown>
function expenseToApi(e: ExpenseRow) {
  return {
    ...e,
    amount: e.amount / 100,
    splits: e.splits?.map((s) => ({ ...s, amount: s.amount / 100 })),
  }
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
      expenses: {
        include: {
          paidBy: { select: { id: true, name: true, email: true, image: true } },
          splits: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { expenses: true } },
    },
    orderBy: { updatedAt: "desc" },
  })

  return Response.json(groups.map((g) => ({ ...g, expenses: g.expenses.map(expenseToApi) })))
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { name, description, color, emoji, currency, location, lat: clientLat, lng: clientLng } = await req.json()

    if (!name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 })

    let lat: number | null = clientLat ?? null
    let lng: number | null = clientLng ?? null
    // only geocode if mobile didn't already send coordinates
    if (location?.trim() && lat === null) {
      try {
        const geo = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location.trim())}&format=json&limit=1`,
          { headers: { "User-Agent": "SplitEase/1.0" } }
        )
        const geoData = await geo.json()
        if (geoData[0]) { lat = parseFloat(geoData[0].lat); lng = parseFloat(geoData[0].lon) }
      } catch { /* geocoding failure is non-fatal */ }
    }

    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        description: description?.trim(),
        color: color ?? "#6366f1",
        emoji: emoji ?? "💰",
        currency: currency ?? "USD",
        location: location?.trim() ?? null,
        lat,
        lng,
        createdById: user.id,
        members: { create: { userId: user.id, role: "ADMIN" } },
      },
      include: { members: { include: { user: true } } },
    })

    logActivity({
      type: "group_created",
      actorId: user.id,
      groupId: group.id,
      meta: { groupName: group.name, groupEmoji: group.emoji },
    })

    return Response.json(group, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to create group" }, { status: 500 })
  }
}
