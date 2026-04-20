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

  const [group, expenses, settlements, members] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { currency: true } }),
    prisma.expense.findMany({ where: { groupId }, include: { splits: true } }),
    prisma.settlement.findMany({ where: { groupId } }),
    prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    }),
  ])

  const defaultCurrency = group?.currency ?? "USD"
  const memberMap = Object.fromEntries(members.map((m) => [m.userId, m.user]))

  // Group expenses by their currency
  const expensesByCurrency: Record<string, typeof expenses> = {}
  for (const exp of expenses) {
    const cur = (exp as any).currency ?? defaultCurrency
    if (!expensesByCurrency[cur]) expensesByCurrency[cur] = []
    expensesByCurrency[cur].push(exp)
  }

  // Default currency first, then others alphabetically
  const currencyOrder = [
    defaultCurrency,
    ...Object.keys(expensesByCurrency).filter(c => c !== defaultCurrency).sort(),
  ]

  const result: Array<{ currency: string; balances: any[] }> = []

  for (const currency of currencyOrder) {
    const currencyExpenses = expensesByCurrency[currency] ?? []
    if (currencyExpenses.length === 0) continue

    // Settlements are applied only to the default currency (no currency field on settlements)
    const settlementsForCurrency = currency === defaultCurrency ? settlements : []
    const balanceCents = buildBalanceMap(currencyExpenses, settlementsForCurrency, true)
    const netBalances = getNetBalances(balanceCents)
      .map(({ fromUserId, toUserId, amountCents }) => ({
        fromUserId,
        toUserId,
        fromUser: memberMap[fromUserId],
        toUser: memberMap[toUserId],
        amount: centsToDisplay(amountCents),
      }))

    if (netBalances.length > 0) {
      result.push({ currency, balances: netBalances })
    }
  }

  return Response.json(result)
}
