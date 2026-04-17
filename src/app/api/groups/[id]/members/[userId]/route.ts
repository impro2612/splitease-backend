import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// PATCH /api/groups/:id/members/:userId — toggle ADMIN role
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId, userId: targetUserId } = await params
  const { role } = await req.json()

  if (!["ADMIN", "MEMBER"].includes(role)) {
    return Response.json({ error: "Invalid role" }, { status: 400 })
  }

  // Only admins can change roles
  const requester = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!requester || requester.role !== "ADMIN") {
    return Response.json({ error: "Only admins can change roles" }, { status: 403 })
  }

  // Can't demote yourself if you're the only admin
  if (targetUserId === user.id && role === "MEMBER") {
    const adminCount = await prisma.groupMember.count({
      where: { groupId, role: "ADMIN" },
    })
    if (adminCount <= 1) {
      return Response.json({ error: "Group must have at least one admin" }, { status: 400 })
    }
  }

  const updated = await prisma.groupMember.update({
    where: { groupId_userId: { groupId, userId: targetUserId } },
    data: { role },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  })

  return Response.json(updated)
}
