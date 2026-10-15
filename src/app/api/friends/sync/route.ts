import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { blockedPairs, pairKey } from "@/lib/blocks"

// POST /api/friends/sync
// Backfills ACCEPTED friendships for all co-members in the user's groups
// only when no prior relationship (of any status) and no block exists between the pair.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    select: { groupId: true },
  })
  const coMembers = await prisma.groupMember.findMany({
    where: { groupId: { in: memberships.map((m) => m.groupId) }, userId: { not: user.id } },
    select: { userId: true },
    distinct: ["userId"],
  })
  const coMemberIds = coMembers.map((m) => m.userId)
  if (coMemberIds.length === 0) return Response.json({ synced: 0 })

  const [existing, blocked] = await Promise.all([
    prisma.friend.findMany({
      where: {
        OR: [
          { requesterId: user.id, addresseeId: { in: coMemberIds } },
          { requesterId: { in: coMemberIds }, addresseeId: user.id },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    }),
    blockedPairs(user.id, coMemberIds),
  ])
  const related = new Set(existing.flatMap((f) => [f.requesterId, f.addresseeId]))

  let created = 0
  for (const otherId of coMemberIds) {
    if (related.has(otherId) || blocked.has(pairKey(user.id, otherId))) continue
    await prisma.friend.create({
      data: { requesterId: user.id, addresseeId: otherId, status: "ACCEPTED" },
    })
    created++
  }

  return Response.json({ synced: created })
}
