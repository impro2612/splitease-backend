import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { sendPushNotification } from "@/lib/push"

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
  if (!admin) return Response.json({ error: "Not a member" }, { status: 403 })

  try {
    const { email } = await req.json()

    if (!email) return Response.json({ error: "Email is required" }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return Response.json({ error: "No user found with that email" }, { status: 404 })
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    })
    if (existing) {
      return Response.json({ error: "User is already a member" }, { status: 409 })
    }

    const member = await prisma.groupMember.create({
      data: { groupId, userId: user.id, role: "MEMBER" },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    })

    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })

    // Auto-create ACCEPTED friendships between the new member and all existing group members
    const existingMembers = await prisma.groupMember.findMany({
      where: { groupId, userId: { not: user.id } },
      select: { userId: true },
    })

    for (const em of existingMembers) {
      const alreadyFriends = await prisma.friend.findFirst({
        where: {
          OR: [
            { requesterId: em.userId, addresseeId: user.id },
            { requesterId: user.id, addresseeId: em.userId },
          ],
        },
      })
      if (!alreadyFriends) {
        await prisma.friend.create({
          data: { requesterId: em.userId, addresseeId: user.id, status: "ACCEPTED" },
        })
      }
    }

    // Send push notification to the newly added member
    const [newMemberWithToken, group, adder] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { pushToken: true } }),
      prisma.group.findUnique({ where: { id: groupId }, select: { name: true, emoji: true } }),
      prisma.user.findUnique({ where: { id: admin.userId }, select: { name: true } }),
    ])
    if (newMemberWithToken?.pushToken && group) {
      await sendPushNotification(
        newMemberWithToken.pushToken,
        `${group.emoji} Added to ${group.name}`,
        `${adder?.name ?? "Someone"} added you to "${group.name}". Open SplitEase to view it.`,
        { groupId }
      )
    }

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

  await prisma.groupMember.delete({
    where: { groupId_userId: { groupId, userId } },
  })

  return Response.json({ success: true })
}
