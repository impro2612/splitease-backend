import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import * as jose from "jose"
import * as crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { MOBILE_JWT_SECRET } from "@/lib/jwt-secret"
import { checkRateLimit } from "@/lib/rate-limit"

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

async function issueTokenPair(userId: string, email: string, name: string | null) {
  const accessToken = await new jose.SignJWT({ id: userId, email, name })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(MOBILE_JWT_SECRET)

  // 64-byte random refresh token — never stored plain, only its SHA-256 hash
  const rawRefresh = crypto.randomBytes(64).toString("hex")
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days

  await prisma.mobileRefreshToken.create({
    data: { userId, tokenHash: hashToken(rawRefresh), expiresAt },
  })

  return { accessToken, refreshToken: rawRefresh }
}

// Warm-up ping — fires a cheap Prisma query so the DB connection is open
// by the time the user submits credentials.
export async function GET() {
  await prisma.$queryRaw`SELECT 1`
  return Response.json({ ok: true })
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
    // 10 attempts per 15 minutes per IP — brute-force protection
    if (!checkRateLimit(`signin:${ip}`, 10, 15 * 60 * 1000)) {
      return Response.json({ error: "Too many sign-in attempts. Please try again later." }, { status: 429 })
    }

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

    // Silently re-hash if stored at a higher cost so future logins are faster
    const storedCost = parseInt(user.password.split("$")[2] ?? "10", 10)
    if (storedCost > 10) {
      const rehashed = await bcrypt.hash(password, 10)
      await prisma.user.update({ where: { id: user.id }, data: { password: rehashed } })
    }

    const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.name)

    return Response.json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, image: user.image },
    })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Server error" }, { status: 500 })
  }
}
