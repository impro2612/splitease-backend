const NO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "IDR", "HUF", "CLP", "COP"])

export function isNoDecimalCurrency(code: string) {
  return NO_DECIMAL_CURRENCIES.has(code)
}

export type SplitRow = { userId: string; amount: number; paid: boolean }
type Result = { ok: true; splits: SplitRow[] } | { ok: false; error: string }

/**
 * Validates client-supplied EXACT splits (amounts in display units) and converts
 * them to integer cents that sum exactly to totalCents.
 * Rejects non-members, duplicates, negative/non-finite amounts, and sums that are
 * off by more than one cent per participant (normal rounding noise).
 */
export function buildExactSplits(
  raw: unknown,
  totalCents: number,
  paidById: string,
  memberIds: Set<string>
): Result {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "At least one split is required" }
  const seen = new Set<string>()
  const rows: SplitRow[] = []
  for (const s of raw as { userId?: unknown; amount?: unknown }[]) {
    const userId = typeof s?.userId === "string" ? s.userId : ""
    const amount = typeof s?.amount === "number" ? s.amount : parseFloat(String(s?.amount))
    if (!memberIds.has(userId)) return { ok: false, error: "Every split must belong to a group member" }
    if (seen.has(userId)) return { ok: false, error: "Duplicate member in splits" }
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Split amounts must be zero or positive" }
    seen.add(userId)
    rows.push({ userId, amount: Math.round(amount * 100), paid: userId === paidById })
  }
  const diff = totalCents - rows.reduce((a, r) => a + r.amount, 0)
  if (Math.abs(diff) > rows.length) {
    return { ok: false, error: `Split amounts sum to ${(totalCents - diff) / 100} but expense is ${totalCents / 100}` }
  }
  // Absorb rounding noise into the largest share so totals are exact and nothing goes negative
  if (diff !== 0) {
    const target = rows.reduce((best, r) => (r.amount > best.amount ? r : best), rows[0])
    target.amount += diff
  }
  return { ok: true, splits: rows.filter((r) => r.amount > 0 || r.paid) }
}

/** Percentage splits (each 0 < p ≤ 100, summing to 100) → exact cents. */
export function buildPercentageSplits(
  raw: unknown,
  totalCents: number,
  paidById: string,
  memberIds: Set<string>
): Result {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "At least one split is required" }
  const seen = new Set<string>()
  const items: { userId: string; percentage: number }[] = []
  for (const s of raw as { userId?: unknown; percentage?: unknown }[]) {
    const userId = typeof s?.userId === "string" ? s.userId : ""
    const percentage = Number(s?.percentage)
    if (!memberIds.has(userId)) return { ok: false, error: "Every split must belong to a group member" }
    if (seen.has(userId)) return { ok: false, error: "Duplicate member in splits" }
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      return { ok: false, error: "Each percentage must be between 0 and 100" }
    }
    seen.add(userId)
    items.push({ userId, percentage })
  }
  const pctSum = items.reduce((a, s) => a + s.percentage, 0)
  if (Math.abs(pctSum - 100) > 0.01) return { ok: false, error: `Percentages sum to ${pctSum.toFixed(2)}% instead of 100%` }
  const raws = items.map((s) => Math.floor((s.percentage / 100) * totalCents))
  let remainder = totalCents - raws.reduce((a, b) => a + b, 0)
  return {
    ok: true,
    splits: items.map((s, i) => {
      const extra = remainder > 0 ? 1 : 0
      if (remainder > 0) remainder--
      return { userId: s.userId, amount: raws[i] + extra, paid: s.userId === paidById }
    }),
  }
}

/** Equal split across the given members (whole base units for zero-decimal currencies). */
export function buildEqualSplits(memberIds: string[], totalCents: number, paidById: string, currency: string): SplitRow[] {
  const n = memberIds.length
  const unit = isNoDecimalCurrency(currency) ? 100 : 1
  const totalUnits = Math.round(totalCents / unit)
  const base = Math.floor(totalUnits / n)
  const extra = totalUnits - base * n
  return memberIds.map((userId, i) => ({ userId, amount: (base + (i < extra ? 1 : 0)) * unit, paid: userId === paidById }))
}
