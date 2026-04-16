import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPasswordResetEmail } from "@/lib/mailer"

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email) return Response.json({ error: "Email is required" }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

  // Always return success to prevent email enumeration
  if (!user) return Response.json({ success: true })

  // Invalidate any existing unused tokens for this email
  await prisma.passwordReset.updateMany({
    where: { email: user.email, used: false },
    data: { used: true },
  })

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min

  await prisma.passwordReset.create({
    data: { email: user.email, token: otp, expiresAt },
  })

  await sendPasswordResetEmail(user.email, otp)

  return Response.json({ success: true })
}
