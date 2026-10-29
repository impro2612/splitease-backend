// Group photos: real photos of the place from Wikipedia, and (when UNSPLASH_ACCESS_KEY is
// set) Unsplash photos for everything else. Results are cached for a day per query.

export type GroupImageCredit = { source: "wikipedia" | "unsplash"; name: string; link: string }
export type GroupImage = { url: string; thumb: string; credit: GroupImageCredit; downloadLocation?: string }

const UA = "SplitIT/1.0 (https://splitwithease.vercel.app; group photos)"
const DAY = 60 * 60 * 24

// Only photos from these hosts may be saved on a group
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org", "images.unsplash.com"])
export function isAllowedImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 1000) return false
  try {
    const u = new URL(url)
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

export function parseCredit(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null
  const c = raw as Record<string, unknown>
  if ((c.source !== "wikipedia" && c.source !== "unsplash") || typeof c.name !== "string" || typeof c.link !== "string") return null
  if (!/^https:\/\/([a-z]+\.)?(wikipedia\.org|wikimedia\.org|unsplash\.com)\//.test(c.link)) return null
  return JSON.stringify({ source: c.source, name: c.name.slice(0, 120), link: c.link.slice(0, 500) })
}

// Words that describe the outing rather than the place: "Manali trip 2027" → "Manali"
const FILLER = /\b(trip|trips|tour|travel|vacation|holiday|holidays|getaway|weekend|outing|plan|plans|group|gang|squad|friends|boys|girls|family|with|and|the|to|in|of|for|our|my|road|ride|bike|visit|journey|\d{2,4}|'s)\b/gi

export function placeQueries(name: string, location?: string | null): string[] {
  const out: string[] = []
  const loc = (location ?? "").split(",")[0]?.trim()
  if (loc) out.push(loc)
  const cleaned = name.replace(FILLER, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()
  if (cleaned && !out.some((q) => q.toLowerCase() === cleaned.toLowerCase())) out.push(cleaned)
  return out
}

/** Lead photos of places matching the query. Only pages with coordinates count as places. */
export async function wikipediaPlacePhotos(query: string): Promise<GroupImage[]> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", redirects: "1",
    generator: "search", gsrsearch: query, gsrlimit: "6", gsrnamespace: "0",
    prop: "pageimages|coordinates", piprop: "thumbnail|name", pithumbsize: "640", pilicense: "free",
  })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": UA },
    next: { revalidate: DAY },
  }).catch(() => null)
  if (!res?.ok) return []
  const data = await res.json().catch(() => null)
  const pages: any[] = data?.query?.pages ?? []
  return pages
    .filter((p) => p.coordinates && p.thumbnail?.source && p.pageimage)
    // Skip maps, flags, seals and diagrams — we want a photo of the place
    .filter((p) => !/(map|flag|locator|seal|emblem|logo|coat_of_arms|\.svg)/i.test(p.pageimage))
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    // Only the best match: lower results are often other places with the same name
    // (Manali, Chennai) or something nearby rather than the place itself
    .slice(0, 1)
    .filter((p) => !/(bajaj|vehicle|car_|motorcycle|scooter|barricade|portrait)/i.test(p.pageimage))
    .map((p) => ({
      url: p.thumbnail.source,
      thumb: p.thumbnail.source,
      credit: {
        source: "wikipedia" as const,
        name: p.title,
        link: `https://en.wikipedia.org/wiki/File:${encodeURIComponent(p.pageimage)}`,
      },
    }))
}

// Words people use for groups that photo sites don't tag well → what to search instead
const PHOTO_SYNONYMS: Record<string, string> = {
  flatmates: "roommates", flatmate: "roommates", roommate: "roommates", flat: "apartment", pg: "shared room",
  hostel: "hostel", timepass: "friends hanging out", chill: "friends hanging out", gang: "friends group",
  squad: "friends group", bday: "birthday", "b'day": "birthday", shaadi: "indian wedding", sangeet: "indian wedding",
  mehendi: "henna", haldi: "indian wedding", ipl: "cricket", ration: "groceries", bills: "paying bills",
  ghar: "family home", bhai: "brothers", dosti: "friends", yaar: "friends", booze: "drinks", nye: "new year party",
  ganpati: "ganesh festival", garba: "navratri", diwali: "diwali", holi: "holi festival", offsite: "team offsite",
}

/** Search terms to try, best first: the theme as typed (with synonyms), then each word alone */
export function photoQueries(theme: string): string[] {
  const words = theme.toLowerCase().split(/\s+/).filter(Boolean)
  const mapped = words.map((w) => PHOTO_SYNONYMS[w] ?? w)
  const out = [mapped.join(" "), ...mapped]
  return [...new Set(out.filter(Boolean))]
}

export const unsplashEnabled = () => !!process.env.UNSPLASH_ACCESS_KEY

export async function unsplashPhotos(query: string, page = 1): Promise<GroupImage[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key || !query.trim()) return []
  const params = new URLSearchParams({ query, page: String(page), per_page: "8", orientation: "squarish", content_filter: "high" })
  const res = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    next: { revalidate: DAY },
  }).catch(() => null)
  if (!res?.ok) return []
  const data = await res.json().catch(() => null)
  const utm = "utm_source=splitit&utm_medium=referral"
  return (data?.results ?? []).map((p: any) => ({
    url: `${p.urls.raw}&w=640&h=640&fit=crop&q=80`,
    thumb: `${p.urls.raw}&w=200&h=200&fit=crop&q=70`,
    credit: { source: "unsplash" as const, name: p.user?.name ?? "Unsplash", link: `${p.user?.links?.html ?? "https://unsplash.com"}?${utm}` },
    downloadLocation: p.links?.download_location,
  }))
}
