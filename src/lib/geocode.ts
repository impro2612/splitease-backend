const USER_AGENT = "SplitIT/1.0 (+https://splitwithease.vercel.app)"

/** Best-effort place lookup via OpenStreetMap Nominatim; returns null on any failure. */
export async function geocode(location: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(5_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.[0]) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  } catch {
    return null
  }
}
