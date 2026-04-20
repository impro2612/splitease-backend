import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildBalanceMap, getUserTotals, centsToDisplay } from "@/lib/balance"
import { convertDisplayAmount } from "@/lib/exchange"
import { roundDisplayAmount } from "@/lib/currency"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const displayCurrency = (url.searchParams.get("currency") ?? "USD").toUpperCase()

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    select: { id: true, currency: true },
  })

  if (groups.length === 0) {
    return Response.json({
      currency: displayCurrency,
      totalOwed: 0,
      totalOwe: 0,
      net: 0,
    })
  }

  let totalOwed = 0
  let totalOwe = 0

  for (const group of groups) {
    const [expenses, settlements] = await Promise.all([
      prisma.expense.findMany({ where: { groupId: group.id }, include: { splits: true } }),
      prisma.settlement.findMany({ where: { groupId: group.id } }),
    ])

    // Group expenses by their individual currency
    const expensesByCurrency: Record<string, typeof expenses> = {}
    for (const exp of expenses) {
      const cur = (exp as any).currency ?? group.currency
      if (!expensesByCurrency[cur]) expensesByCurrency[cur] = []
      expensesByCurrency[cur].push(exp)
    }

    for (const [currency, currencyExpenses] of Object.entries(expensesByCurrency)) {
      // Settlements only apply to the group's default currency
      const settlementsForCurrency = currency === group.currency ? settlements : []
      const balanceCents = buildBalanceMap(currencyExpenses, settlementsForCurrency, true)
      const { oweCents, owedCents } = getUserTotals(balanceCents, user.id)

      const oweDisplay = centsToDisplay(oweCents)
      const owedDisplay = centsToDisplay(owedCents)

      totalOwe += await convertDisplayAmount(oweDisplay, currency, displayCurrency)
      totalOwed += await convertDisplayAmount(owedDisplay, currency, displayCurrency)
    }
  }

  totalOwe = roundDisplayAmount(totalOwe, displayCurrency)
  totalOwed = roundDisplayAmount(totalOwed, displayCurrency)

  return Response.json({
    currency: displayCurrency,
    totalOwed,
    totalOwe,
    net: roundDisplayAmount(totalOwed - totalOwe, displayCurrency),
  })
}
