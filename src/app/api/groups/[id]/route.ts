import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { logActivity } from "@/lib/activity"

type ExpenseRow = { amount: number; splits?: { amount: number }[] } & Record<string, unknown>
function expenseToApi(e: ExpenseRow) {
  return {
    ...e,
    amount: e.amount / 100,
    splits: e.splits?.map((s) => ({ ...s, amount: s.amount / 100 })),
  }
}

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

  return Response.json({
    ...group,
    expenses: group.expenses.map(expenseToApi),
    settlements: group.settlements.map((s) => ({ ...s, amount: s.amount / 100 })),
  })
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

  const existingGroup = await prisma.group.findUnique({
    where: { id },
    select: { name: true, emoji: true, currency: true, _count: { select: { expenses: true, settlements: true } } },
  })
  if (!existingGroup) return Response.json({ error: "Group not found" }, { status: 404 })

  if (currency !== undefined) {
    const hasMoneyActivity = existingGroup._count.expenses > 0 || existingGroup._count.settlements > 0
    if (hasMoneyActivity && currency !== existingGroup.currency) {
      return Response.json(
        { error: "Cannot change currency after expenses or settlements exist" },
        { status: 400 }
      )
    }
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

  if (name !== undefined && name !== existingGroup.name) {
    logActivity({
      type: "group_renamed",
      actorId: user.id,
      groupId: id,
      meta: { oldName: existingGroup.name, newName: group.name, groupEmoji: group.emoji },
    })
  }

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

  const groupToDelete = await prisma.group.findUnique({
    where: { id },
    select: { name: true, emoji: true },
  })

  // Log before delete so groupId relation is still valid (onDelete: SetNull keeps the row)
  await logActivity({
    type: "group_deleted",
    actorId: user.id,
    groupId: id,
    meta: { groupName: groupToDelete?.name, groupEmoji: groupToDelete?.emoji },
  })

  await prisma.group.delete({ where: { id } })
  return Response.json({ success: true })
}
