import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { placeQueries, unsplashPhotos, wikipediaPlacePhotos, type GroupImage } from "@/lib/group-image"

// GET /api/group-image?name=&location=&theme=&page= — photo suggestions for a group:
// real photos of the place first (Wikipedia), then Unsplash photos for the theme
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!await checkRateLimit(`group-image:${user.id}`, 30, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }

  const url = new URL(req.url)
  const name = (url.searchParams.get("name") ?? "").slice(0, 100)
  const location = (url.searchParams.get("location") ?? "").slice(0, 200)
  const theme = (url.searchParams.get("theme") ?? "").slice(0, 100)
  const page = Math.min(Math.max(parseInt(url.searchParams.get("page") ?? "1") || 1, 1), 10)
  if (!name.trim() && !location.trim()) return Response.json({ images: [] })

  const places = placeQueries(name, location)
  const [wiki, unsplash] = await Promise.all([
    // Place photos don't page — the first page has them all
    page === 1 ? Promise.all(places.map(wikipediaPlacePhotos)).then((r) => r.flat()) : Promise.resolve([] as GroupImage[]),
    unsplashPhotos(theme.trim() || places[0] || name, page),
  ])

  const seen = new Set<string>()
  const images = [...wiki, ...unsplash].filter((i) => !seen.has(i.url) && seen.add(i.url)).slice(0, 12)
  return Response.json({ images, hasMore: unsplash.length > 0 })
}
