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
