import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildBalanceMap, getUserTotals, centsToDisplay } from "@/lib/balance"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    select: { id: true, currency: true },
  })

  if (groups.length === 0) {
    return Response.json({ perCurrency: {} })
  }

  // Accumulate raw owe/owed per currency — client will convert using its own cached rates
  const perCurrency: Record<string, { owe: number; owed: number }> = {}

  for (const group of groups) {
    const [expenses, settlements] = await Promise.all([
      prisma.expense.findMany({ where: { groupId: group.id }, include: { splits: true } }),
      prisma.settlement.findMany({ where: { groupId: group.id } }),
    ])

    const expensesByCurrency: Record<string, typeof expenses> = {}
    for (const exp of expenses) {
      const cur = (exp as { currency?: string }).currency ?? group.currency
      if (!expensesByCurrency[cur]) expensesByCurrency[cur] = []
      expensesByCurrency[cur].push(exp)
    }

    for (const [currency, currencyExpenses] of Object.entries(expensesByCurrency)) {
      const settlementsForCurrency = settlements.filter(
        (s) => ((s as { currency?: string }).currency ?? group.currency) === currency
      )
      const balanceCents = buildBalanceMap(currencyExpenses, settlementsForCurrency, true)
      const { oweCents, owedCents } = getUserTotals(balanceCents, user.id)

      if (!perCurrency[currency]) perCurrency[currency] = { owe: 0, owed: 0 }
      perCurrency[currency].owe += centsToDisplay(oweCents)
      perCurrency[currency].owed += centsToDisplay(owedCents)
    }
  }

  return Response.json({ perCurrency })
}
