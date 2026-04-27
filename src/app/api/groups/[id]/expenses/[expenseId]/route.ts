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
    const { description, amount, category, paidById, date, currency, splitType: reqSplitType, splits: reqSplits } = await req.json()

    const numAmount = amount !== undefined ? parseFloat(amount) : undefined
    if (numAmount !== undefined && (isNaN(numAmount) || numAmount <= 0)) {
      return Response.json({ error: "Invalid amount" }, { status: 400 })
    }

    const newAmountCents = numAmount !== undefined ? Math.round(numAmount * 100) : expense.amount
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

    let newSplitData: { userId: string; amount: number; paid: boolean }[]

    if (reqSplits && Array.isArray(reqSplits) && reqSplits.length > 0) {
      // Explicit splits provided by client — use them directly
      const rawData = (reqSplits as { userId: string; amount: number }[]).map((s) => ({
        userId: s.userId,
        amount: Math.round(s.amount * 100),
        paid: s.userId === newPaidById,
      }))
      // Fix any rounding so totals always sum to newAmountCents
      const rawSum = rawData.reduce((a, b) => a + b.amount, 0)
      let remainder = newAmountCents - rawSum
      newSplitData = rawData.map((s) => {
        const extra = remainder > 0 ? 1 : remainder < 0 ? -1 : 0
        if (remainder !== 0) remainder -= extra
        return { ...s, amount: s.amount + extra }
      })
    } else {
      // No explicit splits — fall back to proportional scaling / paid-flag update
      const amountChanged = newAmountCents !== expense.amount
      const payerChanged = paidById !== undefined && paidById !== expense.paidById

      if (!amountChanged && !payerChanged) {
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
          { type: "expense_updated", groupId, expenseId: updated.id, url: buildAppUrl(`group/${groupId}`) },
          [user.id]
        )
        return Response.json(expenseToApi(updated))
      }

      const existingSplits = await prisma.expenseSplit.findMany({ where: { expenseId } })
      if (amountChanged) {
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
        newSplitData = existingSplits.map((s) => ({
          userId: s.userId, amount: s.amount, paid: s.userId === newPaidById,
        }))
      }
    }

    await prisma.expenseSplit.deleteMany({ where: { expenseId } })

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(description !== undefined && { description }),
        ...(newAmountCents !== expense.amount && { amount: newAmountCents }),
        ...(reqSplitType !== undefined && { splitType: reqSplitType }),
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
