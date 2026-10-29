import { prisma } from "@/lib/prisma"

// GET /api/group-photo/:id — the image itself. Photos never change (a new upload gets a
// new id), so they can be cached forever. Ids are unguessable cuids.
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
