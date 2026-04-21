import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await prisma.$transaction(async (tx) => {
      // Delete settlements (no cascade on fromUser/toUser)
      await tx.settlement.deleteMany({
        where: { OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
      })
      // Delete expenses paid or created by this user (splits cascade)
      await tx.expense.deleteMany({
        where: { OR: [{ paidById: user.id }, { createdById: user.id }] },
      })
      // Delete group memberships (ExpenseSplit cascades)
      await tx.groupMember.deleteMany({ where: { userId: user.id } })
      // Reassign createdById on groups that still have other members
      const ownedGroups = await tx.group.findMany({
        where: { createdById: user.id },
        include: { members: { take: 1 } },
      })
      for (const group of ownedGroups) {
        if (group.members.length > 0) {
          await tx.group.update({
            where: { id: group.id },
            data: { createdById: group.members[0].userId },
          })
        }
      }
      // Delete groups this user created that now have no remaining members
      await tx.group.deleteMany({
        where: { createdById: user.id, members: { none: {} } },
      })
      // Delete friend relationships
      await tx.friend.deleteMany({
        where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
      })
      // Delete messages
      await tx.message.deleteMany({
        where: { OR: [{ senderId: user.id }, { receiverId: user.id }] },
      })
      // Delete invitations sent by this user
      await tx.invitation.deleteMany({ where: { invitedById: user.id } })
      // Delete user — sessions and accounts cascade via schema rules
      await tx.user.delete({ where: { id: user.id } })
    })

    return Response.json({ success: true })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to delete account" }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const full = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, image: true },
  })
  return Response.json(full)
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const { name, email, currentPassword, newPassword, image } = body

    const updateData: Record<string, unknown> = {}

    if (name !== undefined) {
      if (!name?.trim()) return Response.json({ error: "Name cannot be empty" }, { status: 400 })
      updateData.name = name.trim()
    }

    if (email !== undefined) {
      if (!email?.trim()) return Response.json({ error: "Email cannot be empty" }, { status: 400 })
      const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })
      if (existing && existing.id !== user.id) {
        return Response.json({ error: "Email already in use by another account" }, { status: 409 })
      }
      updateData.email = email.trim().toLowerCase()
    }

    if (newPassword !== undefined) {
      if (!currentPassword) return Response.json({ error: "Current password is required" }, { status: 400 })
      if (newPassword.length < 6) return Response.json({ error: "New password must be at least 6 characters" }, { status: 400 })

      const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true } })
      if (!dbUser?.password) return Response.json({ error: "Cannot change password for this account" }, { status: 400 })

      const valid = await bcrypt.compare(currentPassword, dbUser.password)
      if (!valid) return Response.json({ error: "Current password is incorrect" }, { status: 401 })

      updateData.password = await bcrypt.hash(newPassword, 10)
    }

    if (image !== undefined) {
      updateData.image = image
    }

    if (Object.keys(updateData).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: { id: true, email: true, name: true, image: true },
    })
    return Response.json(updated)
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to update profile" }, { status: 500 })
  }
}
