const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// Cache keyed by fromCurrency — each entry holds all rates from that currency
const rateCache: Record<string, { rates: Record<string, number>; cachedAt: number }> = {}

async function fetchDirectRates(fromCurrency: string): Promise<Record<string, number>> {
  const from = fromCurrency.toLowerCase()
  const cached = rateCache[from]

  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.rates
  }

  // Primary CDN plus the project's documented fallback mirror
  const sources = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from}.min.json`,
    `https://latest.currency-api.pages.dev/v1/currencies/${from}.min.json`,
  ]
  let data: Record<string, Record<string, number>> | null = null
  for (const url of sources) {
    try {
      const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5_000) })
      if (res.ok) { data = await res.json(); break }
    } catch { /* try next source */ }
  }
  if (!data) throw new Error(`Exchange rate fetch failed for ${fromCurrency}`)

  const rates: Record<string, number> = data[from]

  if (!rates) {
    throw new Error(`No rates found for currency: ${fromCurrency}`)
  }

  rateCache[from] = { rates, cachedAt: Date.now() }
  return rates
}

export async function convertDisplayAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  if (!Number.isFinite(amount) || amount === 0) return 0
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) return amount

  const rates = await fetchDirectRates(fromCurrency)
  const directRate = rates[toCurrency.toLowerCase()]

  if (!directRate) {
    throw new Error(`No direct rate available for ${fromCurrency} -> ${toCurrency}`)
  }

  // Direct multiplication — no USD pivot, no compounding rounding error
  return amount * directRate
}
