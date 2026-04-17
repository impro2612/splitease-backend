export const NO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "IDR", "HUF", "CLP", "COP",
])

export function roundDisplayAmount(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0
  return NO_DECIMAL_CURRENCIES.has(currency)
    ? Math.round(amount)
    : Math.round(amount * 100) / 100
}
