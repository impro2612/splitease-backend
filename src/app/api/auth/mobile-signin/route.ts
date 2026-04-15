import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import * as jose from "jose"
import { prisma } from "@/lib/prisma"

// Simple JWT for mobile clients (separate from NextAuth sessions)
const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET ?? "fallback-secret-change-in-production"
)

// Lightweight warm-up ping — mobile app calls this on the login screen so the
// serverless function is already running by the time the user hits Sign In.
export async function GET() {
  return Response.json({ ok: true })
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return Response.json({ error: "Email and password required" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.password) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 })
    }

    const token = await new jose.SignJWT({
      id: user.id,
      email: user.email,
      name: user.name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(SECRET)

    return Response.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Server error" }, { status: 500 })
  }
}
