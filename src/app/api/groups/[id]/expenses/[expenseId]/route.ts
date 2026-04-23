import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"

type Params = { params: Promise<{ id: string; expenseId: string }> }

type ExpenseRow = { amount: number; splits?: { amount: number }[] } & Record<string, unknown>
function expenseToApi(e: ExpenseRow) {
  return {
    ...e,
    amount: e.amount / 100,
    splits: e.splits?.map((s) => ({ ...s, amount: s.amount / 100 })),
  }
}

// PATCH /api/groups/[id]/expenses/[expenseId]
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
    const { description, amount, category, paidById, date, currency } = await req.json()

    const numAmount = amount !== undefined ? parseFloat(amount) : undefined
    if (numAmount !== undefined && (isNaN(numAmount) || numAmount <= 0)) {
      return Response.json({ error: "Invalid amount" }, { status: 400 })
    }

    // expense.amount is in cents; compare in cents to detect real changes
    const newAmountCents = numAmount !== undefined ? Math.round(numAmount * 100) : expense.amount
    const amountChanged = newAmountCents !== expense.amount
    const payerChanged = paidById !== undefined && paidById !== expense.paidById
    const newPaidById = paidById ?? expense.paidById

    const [groupInfo, groupMembers] = await Promise.all([
      prisma.group.findUnique({
        where: { id: groupId },
        select: { name: true, emoji: true },
      }),
      prisma.groupMember.findMany({
        where: { groupId },
        include: {
          user: {
            select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
          },
        },
      }),
    ])

    if (!amountChanged && !payerChanged) {
      // Only metadata changed — preserve splits exactly as-is
      const updated = await prisma.expense.update({
        where: { id: expenseId },
        data: {
          ...(description !== undefined && { description }),
          ...(category !== undefined && { category }),
          ...(date !== undefined && { date: new Date(date) }),
          ...(currency !== undefined && { currency }),
        },
        include: {
          paidBy: { select: { id: true, name: true, email: true, image: true } },
          splits: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
        },
      })
      await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })
      await notifyUsers(
        groupMembers.map((m) => m.user),
        `${groupInfo?.emoji ?? "✏️"} Expense updated in ${groupInfo?.name ?? "your group"}`,
        `${getDisplayName(user)} updated "${updated.description}"`,
        {
          type: "expense_updated",
          groupId,
          expenseId: updated.id,
          url: buildAppUrl(`group/${groupId}`),
        },
        [user.id]
      )
      return Response.json(expenseToApi(updated))
    }

    // Fetch existing splits (amounts already in cents)
    const existingSplits = await prisma.expenseSplit.findMany({ where: { expenseId } })

    let newSplitData: { userId: string; amount: number; paid: boolean }[]

    if (amountChanged) {
      // Scale each split proportionally (all values in cents)
      const oldCents = expense.amount
      const rawCents = existingSplits.map((s) => Math.floor((s.amount / oldCents) * newAmountCents))
      const rawSum = rawCents.reduce((a, b) => a + b, 0)
      let remainder = newAmountCents - rawSum

      newSplitData = existingSplits.map((s, i) => {
        const extra = remainder > 0 ? 1 : 0
        if (remainder > 0) remainder--
        return { userId: s.userId, amount: rawCents[i] + extra, paid: s.userId === newPaidById }
      })
    } else {
      // Only payer changed — keep amounts, just update paid flags
      newSplitData = existingSplits.map((s) => ({
        userId: s.userId,
        amount: s.amount,
        paid: s.userId === newPaidById,
      }))
    }

    await prisma.expenseSplit.deleteMany({ where: { expenseId } })

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(description !== undefined && { description }),
        ...(amountChanged && { amount: newAmountCents }),
        ...(category !== undefined && { category }),
        ...(paidById !== undefined && { paidById }),
        ...(date !== undefined && { date: new Date(date) }),
        ...(currency !== undefined && { currency }),
        splits: { create: newSplitData },
      },
      include: {
        paidBy: { select: { id: true, name: true, email: true, image: true } },
        splits: {
          include: { user: { select: { id: true, name: true, email: true, image: true } } },
        },
      },
    })

    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })
    await notifyUsers(
      groupMembers.map((m) => m.user),
      `${groupInfo?.emoji ?? "✏️"} Expense updated in ${groupInfo?.name ?? "your group"}`,
      `${getDisplayName(user)} updated "${updated.description}"`,
      {
        type: "expense_updated",
        groupId,
        expenseId: updated.id,
        url: buildAppUrl(`group/${groupId}`),
      },
      [user.id]
    )
    return Response.json(expenseToApi(updated))
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

  const [groupInfo, groupMembers] = await Promise.all([
    prisma.group.findUnique({
      where: { id: groupId },
      select: { name: true, emoji: true },
    }),
    prisma.groupMember.findMany({
      where: { groupId },
      include: {
        user: {
          select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
        },
      },
    }),
  ])

  await prisma.expense.delete({ where: { id: expenseId } })
  await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })
  await notifyUsers(
    groupMembers.map((m) => m.user),
    `${groupInfo?.emoji ?? "🗑️"} Expense removed in ${groupInfo?.name ?? "your group"}`,
    `${getDisplayName(user)} removed "${expense.description}"`,
    {
      type: "expense_deleted",
      groupId,
      expenseId,
      url: buildAppUrl(`group/${groupId}`),
    },
    [user.id]
  )
  return Response.json({ success: true })
}
