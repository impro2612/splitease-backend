import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const { email, token, newPassword } = await req.json()

  if (!email || !token || !newPassword)
    return Response.json({ error: "All fields are required" }, { status: 400 })

  if (newPassword.length < 6)
    return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 })

  const reset = await prisma.passwordReset.findFirst({
    where: { email: email.toLowerCase().trim(), token, used: false },
  })

  if (!reset) return Response.json({ error: "Invalid or expired code" }, { status: 400 })
  if (new Date() > reset.expiresAt) {
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } })
    return Response.json({ error: "Code has expired. Please request a new one." }, { status: 400 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)

  await Promise.all([
    prisma.user.update({ where: { email: reset.email }, data: { password: hashed } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } }),
  ])

  return Response.json({ success: true })
}
