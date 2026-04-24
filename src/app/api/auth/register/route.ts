import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/phone"

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, password } = await req.json()

    if (!email || !password || !name) {
      return Response.json({ error: "Name, email and password are required" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return Response.json({ error: "An account with this email already exists" }, { status: 409 })
    }

    // Phone is optional — only store if provided
    let phoneData: { phone?: string; phoneNormalized?: string } = {}
    if (phone) {
      const normalizedPhone = normalizePhone(phone)
      if (normalizedPhone) {
        const existingPhone = await prisma.user.findFirst({
          where: { OR: [{ phoneNormalized: normalizedPhone }, { phone }] },
        })
        if (existingPhone) {
          return Response.json({ error: "This phone number is already registered" }, { status: 409 })
        }
        phoneData = { phone, phoneNormalized: normalizedPhone }
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, ...phoneData },
    })

    return Response.json({ id: user.id, email: user.email, name: user.name }, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
