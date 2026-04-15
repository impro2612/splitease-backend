import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await params

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!member) return Response.json({ error: "Not a member" }, { status: 403 })

  const [expenses, settlements, members] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId },
      include: { splits: true },
    }),
    prisma.settlement.findMany({ where: { groupId } }),
    prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    }),
  ])

  // Build balance map: balances[fromId][toId] = amount owed
  const balances: Record<string, Record<string, number>> = {}

  const initBalance = (a: string, b: string) => {
    if (!balances[a]) balances[a] = {}
    if (!balances[a][b]) balances[a][b] = 0
  }

  for (const expense of expenses) {
    for (const split of expense.splits) {
      if (split.userId === expense.paidById || split.paid) continue
      initBalance(split.userId, expense.paidById)
      initBalance(expense.paidById, split.userId)
      balances[split.userId][expense.paidById] += split.amount
    }
  }

  for (const settlement of settlements) {
    initBalance(settlement.fromUserId, settlement.toUserId)
    balances[settlement.fromUserId][settlement.toUserId] = Math.max(
      0,
      (balances[settlement.fromUserId]?.[settlement.toUserId] ?? 0) - settlement.amount
    )
  }

  // Simplify: net out mutual debts
  const netBalances: {
    fromUserId: string
    toUserId: string
    fromUser: any
    toUser: any
    amount: number
  }[] = []
  const memberMap = Object.fromEntries(members.map((m) => [m.userId, m.user]))

  const processed = new Set<string>()
  for (const [fromId, toMap] of Object.entries(balances)) {
    for (const [toId, amount] of Object.entries(toMap)) {
      const key = [fromId, toId].sort().join("-")
      if (processed.has(key)) continue
      processed.add(key)

      const reverse = balances[toId]?.[fromId] ?? 0
      const net = amount - reverse

      if (net > 0.01) {
        netBalances.push({
          fromUserId: fromId,
          toUserId: toId,
          fromUser: memberMap[fromId],
          toUser: memberMap[toId],
          amount: Math.round(net * 100) / 100,
        })
      } else if (net < -0.01) {
        netBalances.push({
          fromUserId: toId,
          toUserId: fromId,
          fromUser: memberMap[toId],
          toUser: memberMap[fromId],
          amount: Math.round(-net * 100) / 100,
        })
      }
    }
  }

  return Response.json(netBalances)
}
