import { NextRequest } from "next/server"
import * as crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { sendPasswordResetEmail } from "@/lib/mailer"
import { checkRateLimit } from "@/lib/rate-limit"
import { normalizeEmail } from "@/lib/email"
import { clientIp, readJson } from "@/lib/request"
import { hashResetCode } from "@/lib/reset-code"

const OK = () => Response.json({ success: true }, { status: 200 })

export async function POST(req: NextRequest) {
  if (!await checkRateLimit(`forgot-password:${clientIp(req)}`, 5, 15 * 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 })
  }

  const { email: rawEmail } = await readJson<{ email: string }>(req)
  const email = normalizeEmail(rawEmail)
  if (!email) return Response.json({ error: "Email is required" }, { status: 400 })

  // Per-address limit stops a distributed attacker from flooding one inbox.
  // Responds with success either way so the limit doesn't reveal account existence.
  if (!await checkRateLimit(`forgot-password-email:${email}`, 3, 60 * 60 * 1000)) return OK()

  const user = await prisma.user.findUnique({ where: { email } })
  // Always return success to prevent email enumeration
  if (!user) return OK()

  // Invalidate any existing unused codes for this email
  await prisma.passwordReset.updateMany({
    where: { email: user.email, used: false },
    data: { used: true },
  })

  // 6-digit OTP from a CSPRNG; only its hash is stored
  const otp = crypto.randomInt(100000, 1000000).toString()
  await prisma.passwordReset.create({
    data: { email: user.email, token: hashResetCode(user.email, otp), expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
  })

  try {
    await sendPasswordResetEmail(user.email, otp)
  } catch (err) {
    // Same response as the success path — a mail failure must not reveal the account exists
    console.error("[forgot-password] email send failed", err)
  }
  return OK()
}
