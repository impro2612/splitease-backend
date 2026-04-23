import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"

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
    const { email } = await req.json()

    if (!email) return Response.json({ error: "Email is required" }, { status: 400 })

    const newUser = await prisma.user.findUnique({ where: { email } })
    if (!newUser) {
      return Response.json({ error: "No user found with that email" }, { status: 404 })
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: newUser.id } },
    })
    if (existing) {
      return Response.json({ error: "User is already a member" }, { status: 409 })
    }

    const member = await prisma.groupMember.create({
      data: { groupId, userId: newUser.id, role: "MEMBER" },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    })

    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })

    // Auto-create ACCEPTED friendships between the new member and all existing group members
    const existingMembers = await prisma.groupMember.findMany({
      where: { groupId, userId: { not: newUser.id } },
      select: { userId: true },
    })

    const memberIds = existingMembers.map((m) => m.userId)

    // Fetch all existing friendships involving the new user in one query
    const existingFriendships = await prisma.friend.findMany({
      where: {
        OR: [
          { requesterId: newUser.id, addresseeId: { in: memberIds } },
          { requesterId: { in: memberIds }, addresseeId: newUser.id },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    })
    const alreadyFriendsSet = new Set(
      existingFriendships.flatMap((f) => [f.requesterId, f.addresseeId])
    )

    for (const memberId of memberIds) {
      if (!alreadyFriendsSet.has(memberId)) {
        await prisma.friend.create({
          data: { requesterId: memberId, addresseeId: newUser.id, status: "ACCEPTED" },
        })
      }
    }

    // Send push notification to the newly added member
    const [newMemberWithToken, group, adder, currentMembers] = await Promise.all([
      prisma.user.findUnique({
        where: { id: newUser.id },
        select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
      }),
      prisma.group.findUnique({ where: { id: groupId }, select: { name: true, emoji: true } }),
      prisma.user.findUnique({ where: { id: admin.userId }, select: { name: true } }),
      prisma.groupMember.findMany({
        where: { groupId },
        include: {
          user: {
            select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
          },
        },
      }),
    ])
    if (newMemberWithToken && group) {
      await notifyUsers(
        [newMemberWithToken],
        `${group.emoji} Added to ${group.name}`,
        `${adder?.name ?? "Someone"} added you to "${group.name}". Open SplitIT to view it.`,
        { groupId, type: "member_added", url: buildAppUrl(`group/${groupId}`) }
      )
    }
    await notifyUsers(
      currentMembers.map((m) => m.user),
      `${group?.emoji ?? "👥"} New member in ${group?.name ?? "your group"}`,
      `${getDisplayName(newUser)} joined "${group?.name ?? "your group"}"`,
      {
        type: "member_added",
        groupId,
        userId: newUser.id,
        url: buildAppUrl(`group/${groupId}`),
      },
      [user.id, newUser.id]
    )

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
  const { userId } = await req.json()

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
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
    }),
    prisma.groupMember.findMany({
      where: { groupId, userId: { not: userId } },
      include: {
        user: {
          select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
        },
      },
    }),
  ])

  await prisma.groupMember.delete({
    where: { groupId_userId: { groupId, userId } },
  })

  if (targetUser && targetUser.id !== user.id) {
    await notifyUsers(
      [targetUser],
      `${group?.emoji ?? "👋"} Removed from ${group?.name ?? "group"}`,
      `${getDisplayName(user)} removed you from "${group?.name ?? "this group"}".`,
      {
        type: "member_removed",
        groupId,
        userId,
        url: buildAppUrl("groups"),
      }
    )
  }

  await notifyUsers(
    remainingMembers.map((m) => m.user),
    `${group?.emoji ?? "👥"} Member removed from ${group?.name ?? "your group"}`,
    user.id === userId
      ? `${getDisplayName(user)} left "${group?.name ?? "this group"}".`
      : `${getDisplayName(user)} removed ${targetUser ? getDisplayName(targetUser) : "a member"}.`,
    {
      type: "member_removed",
      groupId,
      userId,
      url: buildAppUrl(`group/${groupId}`),
    },
    [user.id]
  )

  return Response.json({ success: true })
}
