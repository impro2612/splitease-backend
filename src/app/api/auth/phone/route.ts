import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/phone"

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { phone } = await req.json()
  if (!phone?.trim()) return Response.json({ error: "Phone number is required" }, { status: 400 })

  const normalized = normalizePhone(phone.trim())
  if (!normalized || normalized.length < 8) {
    return Response.json({ error: "Invalid phone number" }, { status: 400 })
  }

  const existing = await prisma.user.findFirst({
    where: { phoneNormalized: normalized, NOT: { id: user.id } },
  })
  if (existing) {
    return Response.json({ error: "This phone number is already registered" }, { status: 409 })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { phone: phone.trim(), phoneNormalized: normalized },
  })

  return Response.json({ success: true })
}
