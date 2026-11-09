import { NextRequest } from "next/server"
import { timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"
import { groupPhotoIdFromUrl } from "@/lib/group-photo"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Same check as plus-reminders: Vercel sends `Authorization: Bearer <CRON_SECRET>`
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get("authorization") ?? ""), b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

// GET /api/cron/cleanup — daily Vercel cron. Drops rows that only ever grow otherwise:
// spent/expired reset codes, dead refresh tokens and uploaded group photos nobody kept.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const now = new Date()

  const passwordResets = await prisma.passwordReset.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { used: true, createdAt: { lt: new Date(now.getTime() - DAY) } }] },
  })
  // A rotated token is kept a week so reuse (= theft) can still be detected and the
  // whole family revoked; after that it has no value.
  const refreshTokens = await prisma.mobileRefreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { lt: new Date(now.getTime() - 7 * DAY) } }] },
  })

  // Photos are uploaded first and attached to a group second, so give a fresh upload an
  // hour before treating "no group points at it" as abandoned.
  const referenced = await prisma.group.findMany({
    where: { imageUrl: { contains: "/api/group-photo/" } },
    select: { imageUrl: true },
    distinct: ["imageUrl"],
  })
  const keep = referenced.map((g) => groupPhotoIdFromUrl(g.imageUrl)).filter((id): id is string => id !== null)
  const groupPhotos = await prisma.groupPhoto.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - HOUR) }, id: { notIn: keep } },
  })

  return Response.json({
    passwordResets: passwordResets.count,
    refreshTokens: refreshTokens.count,
    groupPhotos: groupPhotos.count,
  })
}
