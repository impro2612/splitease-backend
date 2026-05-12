import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSessionUser } from "@/lib/mobile-auth"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const groups = await prisma.group.findMany({
    where: {
      members: { some: { userId: user.id } },
      lat: { not: null },
      lng: { not: null },
    },
    select: {
      id: true, name: true, emoji: true, location: true, lat: true, lng: true,
      expenses: { select: { date: true }, orderBy: { date: "asc" } },
    },
  })

  const pins = groups.map((g) => {
    const dates = g.expenses.map((e) => e.date)
    const startDate = dates[0] ?? null
    const endDate = dates[dates.length - 1] ?? null
    return { id: g.id, name: g.name, emoji: g.emoji, location: g.location, lat: g.lat!, lng: g.lng!, startDate, endDate }
  })

  return Response.json(pins)
}
