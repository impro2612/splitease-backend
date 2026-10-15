import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/phone"
import { Prisma } from "@/generated/prisma/client"
import { checkRateLimit } from "@/lib/rate-limit"
import { EMAIL_RE, normalizeEmail } from "@/lib/email"
import { clientIp, readJson } from "@/lib/request"

export async function POST(req: NextRequest) {
  if (!await checkRateLimit(`register:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
    return Response.json({ error: "Too many registrations from this IP. Please try again later." }, { status: 429 })
  }

  try {
    const body = await readJson<{ name: string; email: string; phone: string; password: string }>(req)
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const email = normalizeEmail(body.email)
    const phone = typeof body.phone === "string" ? body.phone.trim() : ""
    const password = typeof body.password === "string" ? body.password : ""

    if (!email || !password || !name) {
      return Response.json({ error: "Name, email and password are required" }, { status: 400 })
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return Response.json({ error: "Invalid email format" }, { status: 400 })
    }
    if (password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }
    if (!/\d/.test(password)) {
      return Response.json({ error: "Password must contain at least one number" }, { status: 400 })
    }
    if (name.length > 100 || password.length > 200) {
      return Response.json({ error: "Name or password is too long" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return Response.json({ error: "An account with this email already exists" }, { status: 409 })
    }

    // Phone is optional — only store if provided
    let phoneData: { phone?: string; phoneNormalized?: string } = {}
    if (phone) {
      const normalizedPhone = normalizePhone(phone)
      if (normalizedPhone.replace(/\D/g, "").length < 8) {
        return Response.json({ error: "Please enter a valid phone number" }, { status: 400 })
      }
      const existingPhone = await prisma.user.findFirst({
        where: { OR: [{ phoneNormalized: normalizedPhone }, { phone }] },
      })
      if (existingPhone) {
        return Response.json({ error: "This phone number is already registered" }, { status: 409 })
      }
      phoneData = { phone, phoneNormalized: normalizedPhone }
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    try {
      const user = await prisma.user.create({
        data: { name, email, password: hashedPassword, ...phoneData },
      })
      return Response.json({ id: user.id, email: user.email, name: user.name }, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Unique constraint — race condition on email or phone
        return Response.json({ error: "An account with this email or phone number already exists" }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
