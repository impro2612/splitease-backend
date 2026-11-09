import { prisma } from "@/lib/prisma"

// GET /api/group-photo/:id — the image itself.
//
// Unauthenticated BY DESIGN: the apps load these through <Image> tags and share the URL
// in push payloads, where attaching a bearer token isn't practical. Access control is the
// unguessability of the cuid id (~120 bits of entropy, never enumerable). Photos never
// change (a new upload gets a new id), so they are served immutable with a one-year
// cache — which also means a URL that has leaked stays viewable until the photo row is
// deleted, and may linger in intermediate caches for up to a year after that.
// The privacy policy (/privacy, "Who can see your information") discloses this.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const photo = await prisma.groupPhoto.findUnique({ where: { id }, select: { mime: true, data: true } })
  if (!photo) return new Response("Not found", { status: 404 })
  return new Response(Buffer.from(photo.data, "base64"), {
    headers: {
      "Content-Type": photo.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
