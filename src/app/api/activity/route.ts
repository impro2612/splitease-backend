import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // Groups the user is a member of
  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    select: { groupId: true },
  })
  const groupIds = memberships.map((m) => m.groupId)

  const activities = await prisma.activity.findMany({
    where: {
      OR: [
        { actorId: user.id },
        { targetUserId: user.id },
        { groupId: { in: groupIds } },
      ],
    },
    include: {
      actor: { select: { id: true, name: true, image: true } },
      targetUser: { select: { id: true, name: true, image: true } },
      group: { select: { id: true, name: true, emoji: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return Response.json(
    activities.map((a) => ({
      ...a,
      meta: (() => { try { return JSON.parse(a.meta) } catch { return {} } })(),
    }))
  )
}
