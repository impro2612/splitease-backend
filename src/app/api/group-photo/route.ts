import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { groupPhotoUrl } from "@/lib/group-image"

const MAX_BYTES = 300_000 // the phone sends a ~400px JPEG, usually 30–60 KB

// POST /api/group-photo — { data: base64 JPEG/PNG/WebP } → { url } to save as a group's imageUrl
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!await checkRateLimit(`group-photo:${user.id}`, 20, 60 * 60 * 1000)) {
    return Response.json({ error: "Too many uploads. Try again later." }, { status: 429 })
  }

  const { data } = await req.json().catch(() => ({}))
  if (typeof data !== "string" || !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
    return Response.json({ error: "Invalid image" }, { status: 400 })
  }
  const bytes = Buffer.from(data, "base64")
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return Response.json({ error: "Image is too large" }, { status: 413 })
  }
  // Trust the file's own signature, not the client, for the content type
  const mime =
    bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg"
    : bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png"
    : bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp"
    : null
  if (!mime) return Response.json({ error: "Only JPEG, PNG or WebP images" }, { status: 400 })

  const photo = await prisma.groupPhoto.create({
    data: { uploaderId: user.id, mime, data: bytes.toString("base64") },
    select: { id: true },
  })
  return Response.json({ url: groupPhotoUrl(photo.id) }, { status: 201 })
}
