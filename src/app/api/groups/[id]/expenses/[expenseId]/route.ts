import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { logActivity } from "@/lib/activity"
import { CURRENCY_RE, parseOptionalDate, readJson, type JsonBody } from "@/lib/request"
import { buildExactSplits } from "@/lib/splits"

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
    const { description, amount, category, paidById, date, currency, splitType: reqSplitType, splits: reqSplits } =
      await readJson<JsonBody>(req)

    const numAmount = amount !== undefined ? (typeof amount === "number" ? amount : parseFloat(amount)) : undefined
    if (numAmount !== undefined && (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 1_000_000)) {
      return Response.json({ error: "Invalid amount" }, { status: 400 })
    }
    if (description !== undefined && (typeof description !== "string" || !description.trim() || description.trim().length > 200)) {
      return Response.json({ error: "Invalid description" }, { status: 400 })
    }
    const parsedDate = parseOptionalDate(date)
    if (date !== undefined && !parsedDate) return Response.json({ error: "Invalid date" }, { status: 400 })
    if (currency !== undefined && (typeof currency !== "string" || !CURRENCY_RE.test(currency))) {
      return Response.json({ error: "Invalid currency" }, { status: 400 })
    }
    if (reqSplitType !== undefined && !["EQUAL", "EXACT", "PERCENTAGE"].includes(reqSplitType)) {
      return Response.json({ error: "Invalid split type" }, { status: 400 })
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

    const memberIdSet = new Set(groupMembers.map((m) => m.userId))
    if (!memberIdSet.has(newPaidById)) {
      return Response.json({ error: "Payer must be a member of this group" }, { status: 400 })
    }

    let newSplitData: { userId: string; amount: number; paid: boolean }[]

    if (reqSplits && Array.isArray(reqSplits) && reqSplits.length > 0) {
      // Explicit splits — same validation as creation (members only, no negatives,
      // no duplicates, sum must match the amount)
      const built = buildExactSplits(reqSplits, newAmountCents, newPaidById, memberIdSet)
      if (!built.ok) return Response.json({ error: built.error }, { status: 400 })
      newSplitData = built.splits
    } else {
      // No explicit splits — fall back to proportional scaling / paid-flag update
      const amountChanged = newAmountCents !== expense.amount
      const payerChanged = paidById !== undefined && paidById !== expense.paidById

      if (!amountChanged && !payerChanged) {
        const updated = await prisma.expense.update({
          where: { id: expenseId },
          data: {
            ...(description !== undefined && { description: description.trim() }),
            ...(category !== undefined && { category }),
            ...(parsedDate && { date: parsedDate }),
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
        after(() => notifyUsers(
          groupMembers.map((m) => m.user),
          `${groupInfo?.emoji ?? "✏️"} Expense updated in ${groupInfo?.name ?? "your group"}`,
          `${getDisplayName(user)} updated "${updated.description}"`,
          { type: "expense_updated", groupId, expenseId: updated.id, url: buildAppUrl(`group/${groupId}`) },
          [user.id]
        ))
        logActivity({
          type: "expense_edited",
          actorId: user.id,
          groupId,
          meta: {
            expenseId: updated.id,
            description: updated.description,
            amount: updated.amount / 100,
            currency: updated.currency,
            groupName: groupInfo?.name,
            groupEmoji: groupInfo?.emoji,
            oldDescription: expense.description !== updated.description ? expense.description : undefined,
            newDescription: expense.description !== updated.description ? updated.description : undefined,
            oldDate: date !== undefined && expense.date?.toISOString() !== updated.date?.toISOString() ? expense.date?.toISOString() : undefined,
            newDate: date !== undefined && expense.date?.toISOString() !== updated.date?.toISOString() ? updated.date?.toISOString() : undefined,
            oldCurrency: expense.currency !== updated.currency ? expense.currency : undefined,
            newCurrency: expense.currency !== updated.currency ? updated.currency : undefined,
          },
        })
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

    const updated = await prisma.$transaction(async (tx) => {
      await tx.expenseSplit.deleteMany({ where: { expenseId } })
      return tx.expense.update({
        where: { id: expenseId },
        data: {
          ...(description !== undefined && { description: description.trim() }),
          ...(newAmountCents !== expense.amount && { amount: newAmountCents }),
          ...(reqSplitType !== undefined && { splitType: reqSplitType }),
          ...(category !== undefined && { category }),
          ...(paidById !== undefined && { paidById }),
          ...(parsedDate && { date: parsedDate }),
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
    })

    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })
    after(() => notifyUsers(
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
    ))
    const oldPaidByMember = groupMembers.find(m => m.userId === expense.paidById)
    const newPaidByMember = groupMembers.find(m => m.userId === updated.paidById)
    logActivity({
      type: "expense_edited",
      actorId: user.id,
      groupId,
      meta: {
        expenseId: updated.id,
        description: updated.description,
        currency: updated.currency,
        groupName: groupInfo?.name,
        groupEmoji: groupInfo?.emoji,
        oldDescription: expense.description !== updated.description ? expense.description : undefined,
        newDescription: expense.description !== updated.description ? updated.description : undefined,
        oldAmount: expense.amount !== updated.amount ? expense.amount / 100 : undefined,
        newAmount: expense.amount !== updated.amount ? updated.amount / 100 : undefined,
        oldPaidByName: expense.paidById !== updated.paidById ? (oldPaidByMember?.user?.name ?? null) : undefined,
        newPaidByName: expense.paidById !== updated.paidById ? (newPaidByMember?.user?.name ?? null) : undefined,
        oldDate: expense.date?.toISOString() !== updated.date?.toISOString() ? expense.date?.toISOString() : undefined,
        newDate: expense.date?.toISOString() !== updated.date?.toISOString() ? updated.date?.toISOString() : undefined,
        oldCurrency: expense.currency !== updated.currency ? expense.currency : undefined,
        newCurrency: expense.currency !== updated.currency ? updated.currency : undefined,
      },
    })
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
  after(() => notifyUsers(
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
  ))
  logActivity({
    type: "expense_deleted",
    actorId: user.id,
    groupId,
    meta: {
      description: expense.description,
      amount: expense.amount / 100,
      currency: expense.currency,
      groupName: groupInfo?.name,
      groupEmoji: groupInfo?.emoji,
    },
  })
  return Response.json({ success: true }, { status: 200 })
}
