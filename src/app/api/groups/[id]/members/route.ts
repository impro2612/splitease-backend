import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { EMAIL_RE, normalizeEmail } from "@/lib/email"
import { readJson } from "@/lib/request"
import { blockedPairs, pairKey } from "@/lib/blocks"

const pushUserSelect = { id: true, name: true, email: true, pushDevices: { select: { token: true } } } as const

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await params

  const admin = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!admin || admin.role !== "ADMIN") {
    return Response.json({ error: "Only admins can add members" }, { status: 403 })
  }

  try {
    const { email: rawEmail } = await readJson<{ email: string }>(req)
    const email = normalizeEmail(rawEmail)

    if (!email) return Response.json({ error: "Email is required" }, { status: 400 })
    if (!EMAIL_RE.test(email)) {
      return Response.json({ error: "Invalid email format" }, { status: 400 })
    }

    const newUser = await prisma.user.findUnique({ where: { email } })
    if (!newUser || email.endsWith("@deleted.invalid")) {
      return Response.json({ error: "No user found with that email" }, { status: 404 })
    }

    const existingMembers = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true, user: { select: { email: true } } },
    })
    if (existingMembers.some((m) => m.userId === newUser.id)) {
      return Response.json({ error: "User is already a member" }, { status: 409 })
    }
    // Deleted accounts stay in the group as history but are never auto-friended
    const memberIds = existingMembers.filter((m) => !m.user.email.endsWith("@deleted.invalid")).map((m) => m.userId)

    // Blocks are honoured both ways: the adder can't pull in someone they blocked or
    // who blocked them, and no friendship is ever auto-created across a block.
    const blocked = await blockedPairs(newUser.id, memberIds)
    if (blocked.has(pairKey(user.id, newUser.id))) {
      return Response.json({ error: "Unable to add this user" }, { status: 403 })
    }

    const member = await prisma.groupMember.create({
      data: { groupId, userId: newUser.id, role: "MEMBER" },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    })
    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })

    // Auto-create ACCEPTED friendships with co-members that have no prior relationship
    // (a REJECTED/REMOVED history is respected) and no block between them.
    const existingFriendships = await prisma.friend.findMany({
      where: {
        OR: [
          { requesterId: newUser.id, addresseeId: { in: memberIds } },
          { requesterId: { in: memberIds }, addresseeId: newUser.id },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    })
    const related = new Set(existingFriendships.flatMap((f) => [f.requesterId, f.addresseeId]))
    for (const memberId of memberIds) {
      if (related.has(memberId) || blocked.has(pairKey(memberId, newUser.id))) continue
      await prisma.friend.create({
        data: { requesterId: memberId, addresseeId: newUser.id, status: "ACCEPTED" },
      })
    }

    after(async () => {
      const [newMemberWithToken, group, currentMembers] = await Promise.all([
        prisma.user.findUnique({ where: { id: newUser.id }, select: pushUserSelect }),
        prisma.group.findUnique({ where: { id: groupId }, select: { name: true, emoji: true } }),
        prisma.groupMember.findMany({ where: { groupId }, include: { user: { select: pushUserSelect } } }),
      ])
      if (newMemberWithToken && group) {
        await notifyUsers(
          [newMemberWithToken],
          `${group.emoji} Added to ${group.name}`,
          `${getDisplayName(user)} added you to "${group.name}". Open SplitIT to view it.`,
          { groupId, type: "member_added", url: buildAppUrl(`group/${groupId}`) }
        )
      }
      await notifyUsers(
        currentMembers.map((m) => m.user),
        `${group?.emoji ?? "👥"} New member in ${group?.name ?? "your group"}`,
        `${getDisplayName(newUser)} joined "${group?.name ?? "your group"}"`,
        { type: "member_added", groupId, userId: newUser.id, url: buildAppUrl(`group/${groupId}`) },
        [user.id, newUser.id]
      )
    })

    return Response.json(member, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to add member" }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await params
  const { userId } = await readJson<{ userId: string }>(req)
  if (typeof userId !== "string" || !userId) {
    return Response.json({ error: "userId is required" }, { status: 400 })
  }

  const admin = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!admin || (admin.role !== "ADMIN" && user.id !== userId)) {
    return Response.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const targetMembership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  })
  if (!targetMembership) {
    return Response.json({ error: "Member not found" }, { status: 404 })
  }

  if (targetMembership.role === "ADMIN") {
    const adminCount = await prisma.groupMember.count({
      where: { groupId, role: "ADMIN" },
    })
    if (adminCount <= 1) {
      return Response.json(
        { error: "Group must have at least one admin. Promote another member or delete the group." },
        { status: 400 }
      )
    }
  }

  const [group, targetUser, remainingMembers] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { name: true, emoji: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: pushUserSelect }),
    prisma.groupMember.findMany({
      where: { groupId, userId: { not: userId } },
      include: { user: { select: pushUserSelect } },
    }),
  ])

  await prisma.groupMember.delete({
    where: { groupId_userId: { groupId, userId } },
  })

  after(async () => {
    if (targetUser && targetUser.id !== user.id) {
      await notifyUsers(
        [targetUser],
        `${group?.emoji ?? "👋"} Removed from ${group?.name ?? "group"}`,
        `${getDisplayName(user)} removed you from "${group?.name ?? "this group"}".`,
        { type: "member_removed", groupId, userId, url: buildAppUrl("groups") }
      )
    }
    await notifyUsers(
      remainingMembers.map((m) => m.user),
      `${group?.emoji ?? "👥"} Member removed from ${group?.name ?? "your group"}`,
      user.id === userId
        ? `${getDisplayName(user)} left "${group?.name ?? "this group"}".`
        : `${getDisplayName(user)} removed ${targetUser ? getDisplayName(targetUser) : "a member"}.`,
      { type: "member_removed", groupId, userId, url: buildAppUrl(`group/${groupId}`) },
      [user.id]
    )
  })

  return Response.json({ success: true }, { status: 200 })
}
