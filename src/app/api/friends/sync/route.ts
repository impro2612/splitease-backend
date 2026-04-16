import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// POST /api/friends/sync
// Backfills ACCEPTED friendships for all co-members in the user's groups.
// Safe to call multiple times — skips pairs that are already friends.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // Get all groups the user belongs to, with all members
  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    select: { groupId: true },
  })

  const groupIds = memberships.map((m) => m.groupId)

  const allMembers = await prisma.groupMember.findMany({
    where: { groupId: { in: groupIds } },
    select: { userId: true, groupId: true },
  })

  // Build set of unique co-member pairs involving this user
  const coMemberIds = new Set<string>()
  for (const m of allMembers) {
    if (m.userId !== user.id) coMemberIds.add(m.userId)
  }

  let created = 0
  for (const otherId of coMemberIds) {
    const existing = await prisma.friend.findFirst({
      where: {
        OR: [
          { requesterId: user.id, addresseeId: otherId },
          { requesterId: otherId, addresseeId: user.id },
        ],
      },
    })
    if (!existing) {
      await prisma.friend.create({
        data: { requesterId: user.id, addresseeId: otherId, status: "ACCEPTED" },
      })
      created++
    }
  }

  return Response.json({ synced: created })
}
