import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const group = await prisma.group.findFirst({
    where: {
      id,
      members: { some: { userId: user.id } },
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      },
      expenses: {
        include: {
          paidBy: { select: { id: true, name: true, email: true, image: true } },
          splits: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      },
      settlements: {
        include: {
          fromUser: { select: { id: true, name: true, email: true, image: true } },
          toUser: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  })

  if (!group) return Response.json({ error: "Group not found" }, { status: 404 })

  return Response.json(group)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { name, description, emoji, color, currency } = await req.json()

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: user.id } },
  })

  if (!member || member.role !== "ADMIN") {
    return Response.json({ error: "Only admins can edit groups" }, { status: 403 })
  }

  const group = await prisma.group.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(emoji !== undefined && { emoji }),
      ...(color !== undefined && { color }),
      ...(currency !== undefined && { currency }),
    },
  })

  return Response.json(group)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: user.id } },
  })

  if (!member || member.role !== "ADMIN") {
    return Response.json({ error: "Only admins can delete groups" }, { status: 403 })
  }

  await prisma.group.delete({ where: { id } })
  return Response.json({ success: true })
}
