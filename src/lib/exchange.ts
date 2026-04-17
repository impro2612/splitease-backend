type RatesResponse = {
  result?: string
  rates?: Record<string, number>
}

const CACHE_TTL_MS = 60 * 60 * 1000

let cachedRates: Record<string, number> | null = null
let cachedAt = 0

async function fetchUsdRates(): Promise<Record<string, number>> {
  const now = Date.now()
  if (cachedRates && now - cachedAt < CACHE_TTL_MS) return cachedRates

  const res = await fetch("https://open.er-api.com/v6/latest/USD", {
    next: { revalidate: 3600 },
  })
  if (!res.ok) {
    throw new Error(`Exchange rate fetch failed with ${res.status}`)
  }

  const data = (await res.json()) as RatesResponse
  if (!data.rates?.USD) {
    throw new Error("Exchange rates response missing USD base rates")
  }

  cachedRates = data.rates
  cachedAt = now
  return data.rates
}

export async function convertDisplayAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  if (!Number.isFinite(amount) || amount === 0) return 0
  if (fromCurrency === toCurrency) return amount

  const rates = await fetchUsdRates()
  const fromRate = rates[fromCurrency]
  const toRate = rates[toCurrency]

  if (!fromRate || !toRate) {
    throw new Error(`Missing exchange rate for ${fromCurrency} -> ${toCurrency}`)
  }

  const usdAmount = amount / fromRate
  return usdAmount * toRate
}
