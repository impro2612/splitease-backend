import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildBalanceMap, getUserTotals, centsToDisplay, getPairwiseNetCents } from "@/lib/balance"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    select: { id: true, currency: true, name: true, emoji: true },
  })

  if (groups.length === 0) {
    return Response.json({ perCurrency: {}, people: [] })
  }

  // Accumulate raw owe/owed per currency — client will convert using its own cached rates
  const perCurrency: Record<string, { owe: number; owed: number }> = {}
  // Per counterparty: net per currency (+ = they owe you) and the groups it comes from
  const people = new Map<string, { nets: Record<string, number>; groups: Map<string, { id: string; name: string; emoji: string }> }>()

  const groupIds = groups.map((g) => g.id)
  const [allExpenses, allSettlements] = await Promise.all([
    prisma.expense.findMany({ where: { groupId: { in: groupIds } }, include: { splits: true } }),
    prisma.settlement.findMany({ where: { groupId: { in: groupIds } } }),
  ])

  const expensesByGroup = new Map<string, typeof allExpenses>()
  for (const e of allExpenses) {
    const list = expensesByGroup.get(e.groupId) ?? []
    list.push(e)
    expensesByGroup.set(e.groupId, list)
  }
  const settlementsByGroup = new Map<string, typeof allSettlements>()
  for (const s of allSettlements) {
    const list = settlementsByGroup.get(s.groupId) ?? []
    list.push(s)
    settlementsByGroup.set(s.groupId, list)
  }

  for (const group of groups) {
    const expenses = expensesByGroup.get(group.id) ?? []
    const settlements = settlementsByGroup.get(group.id) ?? []

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

      // Everyone this user has a pairwise balance with in this group/currency
      const others = new Set<string>()
      for (const e of currencyExpenses) { others.add(e.paidById); for (const sp of e.splits) others.add(sp.userId) }
      for (const st of settlementsForCurrency) { others.add(st.fromUserId); others.add(st.toUserId) }
      others.delete(user.id)
      for (const otherId of others) {
        const theyOweMe = getPairwiseNetCents(balanceCents, otherId, user.id)
        if (theyOweMe === 0) continue
        const entry = people.get(otherId) ?? { nets: {} as Record<string, number>, groups: new Map<string, { id: string; name: string; emoji: string }>() }
        entry.nets[currency] = (entry.nets[currency] ?? 0) + theyOweMe
        entry.groups.set(group.id, { id: group.id, name: group.name, emoji: group.emoji })
        people.set(otherId, entry)
      }

      if (!perCurrency[currency]) perCurrency[currency] = { owe: 0, owed: 0 }
      perCurrency[currency].owe += centsToDisplay(oweCents)
      perCurrency[currency].owed += centsToDisplay(owedCents)
    }
  }

  const users = people.size
    ? await prisma.user.findMany({
        where: { id: { in: [...people.keys()] } },
        select: { id: true, name: true, email: true, image: true },
      })
    : []
  const peopleList = users
    .map((u) => {
      const p = people.get(u.id)!
      const nets = Object.fromEntries(
        Object.entries(p.nets).filter(([, v]) => v !== 0).map(([c, v]) => [c, centsToDisplay(v)])
      )
      return { user: u, nets, groups: [...p.groups.values()] }
    })
    .filter((p) => Object.keys(p.nets).length > 0)

  return Response.json({ perCurrency, people: peopleList })
}
