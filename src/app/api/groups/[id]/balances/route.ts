import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildBalanceMap, getNetBalances, centsToDisplay } from "@/lib/balance"

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
    prisma.expense.findMany({ where: { groupId }, include: { splits: true } }),
    prisma.settlement.findMany({ where: { groupId } }),
    prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    }),
  ])

  const memberMap = Object.fromEntries(members.map((m) => [m.userId, m.user]))
  const balanceCents = buildBalanceMap(expenses, settlements, true)

  const result = getNetBalances(balanceCents).map(({ fromUserId, toUserId, amountCents }) => ({
    fromUserId,
    toUserId,
    fromUser: memberMap[fromUserId],
    toUser: memberMap[toUserId],
    amount: centsToDisplay(amountCents),
  }))

  return Response.json(result)
}
