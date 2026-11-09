import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/phone"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIp, readJson } from "@/lib/request"

// POST /api/auth/phone — set or change the signed-in user's phone number
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // Each attempt probes whether a number is taken, so throttle per account and per network
  if (!await checkRateLimit(`phone:${user.id}`, 10, 60 * 60 * 1000)) {
    return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
  }
  if (!await checkRateLimit(`phone-ip:${clientIp(req)}`, 30, 60 * 60 * 1000)) {
    return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
  }

  const { phone } = await readJson<{ phone: string }>(req)
  if (typeof phone !== "string" || !phone.trim()) return Response.json({ error: "Phone number is required" }, { status: 400 })
  if (phone.length > 32) return Response.json({ error: "Invalid phone number" }, { status: 400 })

  const normalized = normalizePhone(phone.trim())
  if (!normalized || normalized.length < 8) {
    return Response.json({ error: "Invalid phone number" }, { status: 400 })
  }

  const existing = await prisma.user.findFirst({
    where: { phoneNormalized: normalized, NOT: { id: user.id } },
    select: { id: true },
  })
  // Generic wording: don't confirm that the number belongs to another account
  if (existing) {
    return Response.json({ error: "This phone number can't be used" }, { status: 409 })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { phone: phone.trim(), phoneNormalized: normalized },
  })

  return Response.json({ success: true }, { status: 200 })
}
