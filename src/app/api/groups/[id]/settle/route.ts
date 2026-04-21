import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildBalanceMap, getPairwiseNetCents, centsToDisplay } from "@/lib/balance"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await params

  try {
    const { toUserId, amount, note, currency: reqCurrency } = await req.json()

    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    })
    if (!member) return Response.json({ error: "Not a member" }, { status: 403 })

    // --- Validation ---
    const numAmount = parseFloat(amount)
    if (!isFinite(numAmount) || numAmount <= 0) {
      return Response.json({ error: "Settlement amount must be a positive number" }, { status: 400 })
    }
    if (!toUserId || toUserId === user.id) {
      return Response.json({ error: "Invalid recipient" }, { status: 400 })
    }

    // Verify recipient is in the group
    const recipientMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: toUserId } },
    })
    if (!recipientMember) {
      return Response.json({ error: "Recipient is not a member of this group" }, { status: 400 })
    }

    // Load group to determine default currency
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { currency: true } })
    const defaultCurrency = group?.currency ?? "USD"
    const settleCurrency = reqCurrency ?? defaultCurrency

    // Compute current pairwise balance for the specific currency only
    const [expenses, priorSettlements] = await Promise.all([
      prisma.expense.findMany({ where: { groupId }, include: { splits: true } }),
      prisma.settlement.findMany({ where: { groupId } }),
    ])

    // Only consider expenses in the settled currency
    const currencyExpenses = expenses.filter(
      (e) => ((e as { currency?: string }).currency ?? defaultCurrency) === settleCurrency
    )

    // Only apply prior settlements that are in the same currency
    const currencySettlements = priorSettlements.filter(
      (s) => ((s as { currency?: string }).currency ?? defaultCurrency) === settleCurrency
    )

    const balanceCents = buildBalanceMap(currencyExpenses, currencySettlements, true)
    const netDebtCents = getPairwiseNetCents(balanceCents, user.id, toUserId)

    if (netDebtCents <= 0) {
      return Response.json({ error: "You do not owe this person anything in this currency" }, { status: 400 })
    }

    const netDebt = centsToDisplay(netDebtCents)
    // Cap settlement to actual outstanding debt, store as cents
    const cappedAmount = Math.min(numAmount, netDebt)
    const cappedCents = Math.round(cappedAmount * 100)

    const settlement = await prisma.settlement.create({
      data: {
        groupId,
        fromUserId: user.id,
        toUserId,
        amount: cappedCents,
        currency: settleCurrency,
        note,
      },
      include: {
        fromUser: { select: { id: true, name: true, email: true, image: true } },
        toUser: { select: { id: true, name: true, email: true, image: true } },
      },
    })

    return Response.json({ ...settlement, amount: settlement.amount / 100 }, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to record settlement" }, { status: 500 })
  }
}
