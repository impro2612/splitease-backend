import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/phone"

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, password } = await req.json()
    const normalizedPhone = normalizePhone(phone ?? "")

    if (!email || !password || !name || !phone || !normalizedPhone) {
      return Response.json({ error: "All fields are required" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return Response.json({ error: "An account with this email already exists" }, { status: 409 })
    }

    const existingPhone = await prisma.user.findFirst({
      where: {
        OR: [
          { phoneNormalized: normalizedPhone },
          { phone },
        ],
      },
    })
    if (existingPhone) {
      return Response.json({ error: "This phone number is already registered" }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: { name, email, phone, phoneNormalized: normalizedPhone, password: hashedPassword },
    })

    return Response.json({ id: user.id, email: user.email, name: user.name }, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
