import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { normalizeEmail } from "@/lib/email"
import { clientIp, readJson } from "@/lib/request"
import { MAX_RESET_ATTEMPTS, resetCodeMatches } from "@/lib/reset-code"

const INVALID = () => Response.json({ error: "Invalid or expired code" }, { status: 400 })

export async function POST(req: NextRequest) {
  if (!await checkRateLimit(`reset-password:${clientIp(req)}`, 10, 15 * 60 * 1000)) {
    return Response.json({ error: "Too many attempts. Please wait before trying again." }, { status: 429 })
  }

  const { email: rawEmail, token, newPassword } = await readJson<{ email: string; token: string; newPassword: string }>(req)
  const email = normalizeEmail(rawEmail)

  if (!email || typeof token !== "string" || typeof newPassword !== "string" || !token || !newPassword)
    return Response.json({ error: "All fields are required" }, { status: 400 })
  if (newPassword.length < 8)
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 })
  if (!/\d/.test(newPassword))
    return Response.json({ error: "Password must contain at least one number" }, { status: 400 })

  // Only the most recent live code for this email can be used; it burns after
  // MAX_RESET_ATTEMPTS wrong guesses, so the 6-digit space can't be brute-forced.
  const reset = await prisma.passwordReset.findFirst({
    where: { email, used: false },
    orderBy: { createdAt: "desc" },
  })
  if (!reset) return INVALID()
  if (new Date() > reset.expiresAt) {
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } })
    return Response.json({ error: "Code has expired. Please request a new one." }, { status: 400 })
  }

  if (!resetCodeMatches(email, token.trim(), reset.token)) {
    const attempts = reset.attempts + 1
    await prisma.passwordReset.update({
      where: { id: reset.id },
      data: { attempts, used: attempts >= MAX_RESET_ATTEMPTS },
    })
    if (attempts >= MAX_RESET_ATTEMPTS) {
      return Response.json({ error: "Too many incorrect codes. Please request a new one." }, { status: 400 })
    }
    return INVALID()
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) return INVALID()

  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password: hashed } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } }),
    // Sign out every mobile session — a stolen device must not survive a password reset
    prisma.mobileRefreshToken.deleteMany({ where: { userId: user.id } }),
  ])

  return Response.json({ success: true }, { status: 200 })
}
