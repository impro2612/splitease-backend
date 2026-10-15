import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { logActivity } from "@/lib/activity"
import { checkRateLimit } from "@/lib/rate-limit"
import { CURRENCY_RE, parseOptionalDate, readJson, type JsonBody } from "@/lib/request"
import { buildEqualSplits, buildExactSplits, buildPercentageSplits, type SplitRow } from "@/lib/splits"

const MAX_AMOUNT = 1_000_000

const expenseInclude = {
  paidBy: { select: { id: true, name: true, email: true, image: true } },
  splits: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
} as const

/** Convert a DB expense (amounts in cents) to the API shape (amounts in dollars). */
type ExpenseRow = { amount: number; splits?: { amount: number }[] } & Record<string, unknown>
function expenseToApi(e: ExpenseRow) {
  return {
    ...e,
    amount: e.amount / 100,
    splits: e.splits?.map((s) => ({ ...s, amount: s.amount / 100 })),
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // 30 expenses per minute per user
  if (!await checkRateLimit(`expenses:${user.id}`, 30, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }

  const { id: groupId } = await params

  // Verify membership
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!member) return Response.json({ error: "Not a member of this group" }, { status: 403 })

  try {
    const { description, amount, category, paidById, splitType, splits, date, currency, clientRequestId } =
      await readJson<JsonBody>(req)

    // Idempotency: an offline-queued expense retried after a lost response must not duplicate
    if (clientRequestId !== undefined) {
      if (typeof clientRequestId !== "string" || clientRequestId.length > 100) {
        return Response.json({ error: "Invalid clientRequestId" }, { status: 400 })
      }
      const existing = await prisma.expense.findUnique({ where: { clientRequestId }, include: expenseInclude })
      if (existing) {
        if (existing.groupId !== groupId || existing.createdById !== user.id) {
          return Response.json({ error: "Duplicate request id" }, { status: 409 })
        }
        return Response.json(expenseToApi(existing), { status: 200 })
      }
    }

    if (typeof description !== "string" || !description.trim() || !amount || typeof paidById !== "string") {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }
    if (description.trim().length > 200) {
      return Response.json({ error: "Description is too long" }, { status: 400 })
    }

    const numAmount = typeof amount === "number" ? amount : parseFloat(amount)
    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > MAX_AMOUNT) {
      return Response.json({ error: "Invalid amount" }, { status: 400 })
    }

    const expenseDate = parseOptionalDate(date)
    if (expenseDate === undefined) return Response.json({ error: "Invalid date" }, { status: 400 })
    if (currency !== undefined && (typeof currency !== "string" || !CURRENCY_RE.test(currency))) {
      return Response.json({ error: "Invalid currency" }, { status: 400 })
    }

    const [groupData, groupMembers] = await Promise.all([
      prisma.group.findUnique({ where: { id: groupId }, select: { currency: true, name: true, emoji: true } }),
      prisma.groupMember.findMany({
        where: { groupId },
        include: { user: { select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } } } },
      }),
    ])

    const memberIdSet = new Set(groupMembers.map((m) => m.userId))
    if (!memberIdSet.has(paidById)) {
      return Response.json({ error: "Payer must be a member of this group" }, { status: 400 })
    }

    const expenseCurrency = currency ?? groupData?.currency ?? "USD"
    const totalCents = Math.round(numAmount * 100) // canonical: always store 100× base unit

    let splitData: SplitRow[]
    if (splitType === "EQUAL") {
      splitData = buildEqualSplits(groupMembers.map((m) => m.userId), totalCents, paidById, expenseCurrency)
    } else if (splitType === "EXACT" || splitType === "PERCENTAGE") {
      const built = splitType === "EXACT"
        ? buildExactSplits(splits, totalCents, paidById, memberIdSet)
        : buildPercentageSplits(splits, totalCents, paidById, memberIdSet)
      if (!built.ok) return Response.json({ error: built.error }, { status: 400 })
      splitData = built.splits
    } else {
      return Response.json({ error: "Invalid split configuration" }, { status: 400 })
    }

    let expense
    try {
      expense = await prisma.expense.create({
        data: {
          groupId,
          description: description.trim(),
          amount: totalCents, // stored as cents
          currency: expenseCurrency,
          category: typeof category === "string" && category ? category : "general",
          paidById,
          createdById: user.id,
          splitType,
          date: expenseDate ?? new Date(),
          clientRequestId: clientRequestId ?? null,
          splits: { create: splitData },
        },
        include: expenseInclude,
      })
    } catch (err) {
      // Two concurrent retries of the same offline expense: the loser returns the winner's row
      if (clientRequestId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await prisma.expense.findUnique({ where: { clientRequestId }, include: expenseInclude })
        if (existing && existing.groupId === groupId && existing.createdById === user.id) {
          return Response.json(expenseToApi(existing), { status: 200 })
        }
      }
      throw err
    }

    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })

    // Push + activity after the response so latency doesn't grow with group size
    after(async () => {
      await notifyUsers(
        groupMembers.map((m) => m.user),
        `${groupData?.emoji ?? "💸"} New expense in ${groupData?.name ?? "your group"}`,
        `${getDisplayName(user)} added "${expense.description}" for ${expense.amount / 100} ${expense.currency}`,
        { type: "expense_created", groupId, expenseId: expense.id, url: buildAppUrl(`group/${groupId}`) },
        [user.id]
      )
      await logActivity({
        type: "expense_added",
        actorId: user.id,
        groupId,
        meta: {
          expenseId: expense.id,
          description: expense.description,
          amount: expense.amount / 100,
          currency: expense.currency,
          groupName: groupData?.name,
          groupEmoji: groupData?.emoji,
        },
      })
    })

    // Return dollars to client
    return Response.json(expenseToApi(expense), { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to create expense" }, { status: 500 })
  }
}
