import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    select: { id: true },
  })
  const groupIds = groups.map((g) => g.id)

  if (groupIds.length === 0) {
    return Response.json({ totalOwed: 0, totalOwe: 0, net: 0 })
  }

  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId: { in: groupIds } },
      include: { splits: true },
    }),
    prisma.settlement.findMany({
      where: { groupId: { in: groupIds } },
    }),
  ])

  // Build balance map: balances[fromId][toId] = amount fromId owes toId
  const balances: Record<string, Record<string, number>> = {}
  const init = (a: string, b: string) => {
    if (!balances[a]) balances[a] = {}
    if (!balances[a][b] === undefined) balances[a][b] = 0
    if (balances[a][b] === undefined) balances[a][b] = 0
  }

  for (const expense of expenses) {
    for (const split of expense.splits) {
      if (split.userId === expense.paidById || split.paid) continue
      init(split.userId, expense.paidById)
      init(expense.paidById, split.userId)
      balances[split.userId][expense.paidById] =
        (balances[split.userId][expense.paidById] ?? 0) + split.amount
    }
  }

  for (const settlement of settlements) {
    init(settlement.fromUserId, settlement.toUserId)
    balances[settlement.fromUserId][settlement.toUserId] = Math.max(
      0,
      (balances[settlement.fromUserId]?.[settlement.toUserId] ?? 0) - settlement.amount
    )
  }

  // Net out mutual debts and sum user's position
  let totalOwed = 0
  let totalOwe = 0
  const processed = new Set<string>()

  for (const [fromId, toMap] of Object.entries(balances)) {
    for (const [toId, amount] of Object.entries(toMap)) {
      const key = [fromId, toId].sort().join("-")
      if (processed.has(key)) continue
      processed.add(key)

      const reverse = balances[toId]?.[fromId] ?? 0
      const net = amount - reverse

      if (net > 0.01) {
        // fromId owes toId `net`
        if (fromId === user.id) totalOwe += net
        if (toId === user.id) totalOwed += net
      } else if (net < -0.01) {
        // toId owes fromId `-net`
        if (toId === user.id) totalOwe += -net
        if (fromId === user.id) totalOwed += -net
      }
    }
  }

  return Response.json({
    totalOwed: Math.round(totalOwed * 100) / 100,
    totalOwe: Math.round(totalOwe * 100) / 100,
    net: Math.round((totalOwed - totalOwe) * 100) / 100,
  })
}
