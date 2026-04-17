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

    const balanceCents = buildBalanceMap(expenses, settlements, true)
    const { oweCents, owedCents } = getUserTotals(balanceCents, user.id)

    const oweDisplay = centsToDisplay(oweCents)
    const owedDisplay = centsToDisplay(owedCents)

    totalOwe += await convertDisplayAmount(oweDisplay, group.currency, displayCurrency)
    totalOwed += await convertDisplayAmount(owedDisplay, group.currency, displayCurrency)
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
