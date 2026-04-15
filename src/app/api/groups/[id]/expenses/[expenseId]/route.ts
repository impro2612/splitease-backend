import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

type Params = { params: Promise<{ id: string; expenseId: string }> }

// PATCH /api/groups/[id]/expenses/[expenseId] — edit description, amount, category, paidById, date
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId, expenseId } = await params

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!member) return Response.json({ error: "Not a member" }, { status: 403 })

  const expense = await prisma.expense.findUnique({ where: { id: expenseId } })
  if (!expense || expense.groupId !== groupId) {
    return Response.json({ error: "Expense not found" }, { status: 404 })
  }

  try {
    const { description, amount, category, paidById, date } = await req.json()

    const numAmount = amount !== undefined ? parseFloat(amount) : undefined
    if (numAmount !== undefined && (isNaN(numAmount) || numAmount <= 0)) {
      return Response.json({ error: "Invalid amount" }, { status: 400 })
    }

    const newPaidById = paidById ?? expense.paidById
    const newAmount = numAmount ?? expense.amount

    // Re-calculate equal splits if amount or payer changed
    const groupMembers = await prisma.groupMember.findMany({ where: { groupId } })
    const perPerson = Math.round((newAmount / groupMembers.length) * 100) / 100
    const splitData = groupMembers.map((m) => ({
      userId: m.userId,
      amount: perPerson,
      paid: m.userId === newPaidById,
    }))

    // Delete old splits and recreate
    await prisma.expenseSplit.deleteMany({ where: { expenseId } })

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(description !== undefined && { description }),
        ...(numAmount !== undefined && { amount: numAmount }),
        ...(category !== undefined && { category }),
        ...(paidById !== undefined && { paidById }),
        ...(date !== undefined && { date: new Date(date) }),
        splits: { create: splitData },
      },
      include: {
        paidBy: { select: { id: true, name: true, email: true, image: true } },
        splits: {
          include: { user: { select: { id: true, name: true, email: true, image: true } } },
        },
      },
    })

    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })
    return Response.json(updated)
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to update expense" }, { status: 500 })
  }
}

// DELETE /api/groups/[id]/expenses/[expenseId]
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId, expenseId } = await params

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!member) return Response.json({ error: "Not a member" }, { status: 403 })

  const expense = await prisma.expense.findUnique({ where: { id: expenseId } })
  if (!expense || expense.groupId !== groupId) {
    return Response.json({ error: "Expense not found" }, { status: 404 })
  }

  await prisma.expense.delete({ where: { id: expenseId } })
  await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })
  return Response.json({ success: true })
}
