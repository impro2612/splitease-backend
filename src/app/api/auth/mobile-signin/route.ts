import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { normalizeEmail } from "@/lib/email"
import { clientIp, readJson } from "@/lib/request"
import { issueTokenPair } from "@/lib/tokens"

// Warm-up ping — fires a cheap Prisma query so the DB connection is open
// by the time the user submits credentials. Rate-limited so it can't be used
// as a free lever to hammer the database.
export async function GET(req: NextRequest) {
  if (!await checkRateLimit(`warmup:${clientIp(req)}`, 30, 60 * 1000)) {
    return Response.json({ ok: false }, { status: 429 })
  }
  await prisma.$queryRaw`SELECT 1`
  return Response.json({ ok: true }, { status: 200 })
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    // 10 attempts per 15 minutes per IP — brute-force protection
    if (!await checkRateLimit(`signin:${ip}`, 10, 15 * 60 * 1000)) {
      return Response.json({ error: "Too many sign-in attempts. Please try again later." }, { status: 429 })
    }

    const { email: rawEmail, password } = await readJson<{ email: string; password: string }>(req)
    const email = normalizeEmail(rawEmail)
    if (!email || typeof password !== "string" || !password) {
      return Response.json({ error: "Email and password required" }, { status: 400 })
    }
    // Per-account limit too, so rotating IPs can't brute-force one user
    if (!await checkRateLimit(`signin-email:${email}`, 20, 60 * 60 * 1000)) {
      return Response.json({ error: "Too many sign-in attempts. Please try again later." }, { status: 429 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.password) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 })
    }

    // Deliberate trade-off: hashes created at a higher bcrypt cost are re-hashed at
    // cost 10 (OWASP's minimum) because serverless cold starts made cost-12 logins
    // take several seconds. Cost 10 is still ~100 ms/guess on modern hardware.
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
