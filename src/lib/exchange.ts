const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// Cache keyed by fromCurrency — each entry holds all rates from that currency
const rateCache: Record<string, { rates: Record<string, number>; cachedAt: number }> = {}

async function fetchDirectRates(fromCurrency: string): Promise<Record<string, number>> {
  const from = fromCurrency.toLowerCase()
  const cached = rateCache[from]

  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.rates
  }

  const res = await fetch(
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from}.min.json`,
    { next: { revalidate: 3600 } }
  )

  if (!res.ok) {
    throw new Error(`Exchange rate fetch failed for ${fromCurrency}: HTTP ${res.status}`)
  }

  const data = await res.json()
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
  if (fromCurrency === toCurrency) return amount

  const rates = await fetchDirectRates(fromCurrency)
  const directRate = rates[toCurrency.toLowerCase()]

  if (!directRate) {
    throw new Error(`No direct rate available for ${fromCurrency} -> ${toCurrency}`)
  }

  // Direct multiplication — no USD pivot, no compounding rounding error
  return amount * directRate
}
