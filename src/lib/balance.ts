/**
 * Shared balance computation engine.
 *
 * All arithmetic is done in integer cents to avoid floating-point
 * accumulation errors regardless of whether the DB stores amounts
 * as Float (dollars) or Int (cents). Pass `amountsAreInCents: true`
 * once the DB has been migrated to integer cent storage.
 */

export type ExpenseForBalance = {
  paidById: string
  splits: Array<{ userId: string; amount: number; paid: boolean }>
}

export type SettlementForBalance = {
  fromUserId: string
  toUserId: string
  amount: number
}

type BalanceMapCents = Record<string, Record<string, number>>

function toCents(n: number, amountsAreInCents: boolean): number {
  return amountsAreInCents ? Math.round(n) : Math.round(n * 100)
}

/**
 * Builds a pairwise balance map where every value is in integer cents.
 * balanceCents[fromId][toId] = cents that fromId owes toId (before netting).
 */
export function buildBalanceMap(
  expenses: ExpenseForBalance[],
  settlements: SettlementForBalance[],
  amountsAreInCents = false
): BalanceMapCents {
  const balances: BalanceMapCents = {}

  const init = (a: string, b: string) => {
    if (!balances[a]) balances[a] = {}
    if (balances[a][b] === undefined) balances[a][b] = 0
  }

  for (const exp of expenses) {
    for (const split of exp.splits) {
      if (split.userId === exp.paidById || split.paid) continue
      init(split.userId, exp.paidById)
      balances[split.userId][exp.paidById] += toCents(split.amount, amountsAreInCents)
    }
  }

  for (const s of settlements) {
    init(s.fromUserId, s.toUserId)
    balances[s.fromUserId][s.toUserId] = Math.max(
      0,
      (balances[s.fromUserId]?.[s.toUserId] ?? 0) - toCents(s.amount, amountsAreInCents)
    )
  }

  return balances
}

export type NetBalance = {
  fromUserId: string
  toUserId: string
  /** Amount in cents, always positive. */
  amountCents: number
}

/**
 * Nets out mutual debts and returns only non-zero pairwise balances.
 */
export function getNetBalances(balances: BalanceMapCents): NetBalance[] {
  const result: NetBalance[] = []
  const processed = new Set<string>()

  for (const [fromId, toMap] of Object.entries(balances)) {
    for (const [toId, amountCents] of Object.entries(toMap)) {
      const key = [fromId, toId].sort().join("-")
      if (processed.has(key)) continue
      processed.add(key)

      const reverseCents = balances[toId]?.[fromId] ?? 0
      const netCents = amountCents - reverseCents

      if (netCents > 0) {
        result.push({ fromUserId: fromId, toUserId: toId, amountCents: netCents })
      } else if (netCents < 0) {
        result.push({ fromUserId: toId, toUserId: fromId, amountCents: -netCents })
      }
    }
  }

  return result
}

/**
 * Returns the total cents a specific user owes others and is owed by others,
 * after netting out mutual debts.
 */
export function getUserTotals(
  balances: BalanceMapCents,
  userId: string
): { oweCents: number; owedCents: number } {
  let oweCents = 0
  let owedCents = 0
  const processed = new Set<string>()

  for (const [fromId, toMap] of Object.entries(balances)) {
    for (const [toId, amountCents] of Object.entries(toMap)) {
      const key = [fromId, toId].sort().join("-")
      if (processed.has(key)) continue
      processed.add(key)

      const reverseCents = balances[toId]?.[fromId] ?? 0
      const netCents = amountCents - reverseCents

      if (netCents > 0) {
        if (fromId === userId) oweCents += netCents
        if (toId === userId) owedCents += netCents
      } else if (netCents < 0) {
        if (toId === userId) oweCents += -netCents
        if (fromId === userId) owedCents += -netCents
      }
    }
  }

  return { oweCents, owedCents }
}

/** Converts cents to a rounded dollar float for API responses. */
export function centsToDisplay(cents: number): number {
  return Math.round(cents) / 100
}

/**
 * Returns the net debt in cents that `fromUserId` owes `toUserId` in the
 * given balance map (negative means the direction is reversed).
 */
export function getPairwiseNetCents(
  balances: BalanceMapCents,
  fromUserId: string,
  toUserId: string
): number {
  const owedByFrom = balances[fromUserId]?.[toUserId] ?? 0
  const owedByTo = balances[toUserId]?.[fromUserId] ?? 0
  return owedByFrom - owedByTo
}

/**
 * Computes net balance in cents per person across all expenses and settlements.
 * Positive = gets money back. Negative = owes money.
 * Settlements are applied as net adjustments (not pairwise), so cross-pair
 * smart-debt settlements reduce the correct net balances.
 */
export function getNetPerPerson(
  expenses: ExpenseForBalance[],
  settlements: SettlementForBalance[],
  amountsAreInCents = false
): Map<string, number> {
  const net = new Map<string, number>()
  const add = (id: string, delta: number) => net.set(id, (net.get(id) ?? 0) + delta)

  for (const exp of expenses) {
    for (const split of exp.splits) {
      if (split.userId === exp.paidById || split.paid) continue
      const amt = toCents(split.amount, amountsAreInCents)
      add(split.userId, -amt)
      add(exp.paidById, +amt)
    }
  }

  for (const s of settlements) {
    const amt = toCents(s.amount, amountsAreInCents)
    add(s.fromUserId, +amt) // payer's debt shrinks
    add(s.toUserId, -amt)   // receiver's credit shrinks
  }

  return net
}

/**
 * Greedy debt minimisation algorithm.
 * Given net-per-person cents (positive = creditor, negative = debtor),
 * returns the minimum set of transactions that clear all debts.
 */
export function simplifyDebts(netPerPerson: Map<string, number>): NetBalance[] {
  const creditors: { id: string; amount: number }[] = []
  const debtors: { id: string; amount: number }[] = []

  for (const [id, amount] of netPerPerson) {
    if (amount > 1) creditors.push({ id, amount })
    else if (amount < -1) debtors.push({ id, amount: -amount })
  }

  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  const result: NetBalance[] = []
  let ci = 0
  let di = 0

  while (ci < creditors.length && di < debtors.length) {
    const cred = creditors[ci]
    const debt = debtors[di]
    const settle = Math.min(cred.amount, debt.amount)
    if (settle > 0) {
      result.push({ fromUserId: debt.id, toUserId: cred.id, amountCents: settle })
    }
    cred.amount -= settle
    debt.amount -= settle
    if (cred.amount <= 1) ci++
    if (debt.amount <= 1) di++
  }

  return result
}
