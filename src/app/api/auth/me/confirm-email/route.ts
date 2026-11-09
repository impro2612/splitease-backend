import { NextRequest, after } from "next/server"
import { Prisma } from "@/generated/prisma/client"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { EMAIL_RE, normalizeEmail } from "@/lib/email"
import { readJson } from "@/lib/request"
import { hashEmailChangeCode } from "@/lib/reset-code"
import { sendEmailChangedNotice } from "@/lib/mailer"

const INVALID = () => Response.json({ error: "Invalid or expired code" }, { status: 400 })

// POST /api/auth/me/confirm-email — { email, code }
// Second step of an email change started by PATCH /api/auth/me: proves the user can read
// the new inbox, then swaps the address. Refresh tokens are kept so the device in use stays
// signed in; the next access-token refresh embeds the new email (it is read from the DB).
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // 6-digit codes: 5 guesses per quarter hour keeps brute force out of reach
  if (!await checkRateLimit(`email-change-confirm:${user.id}`, 5, 15 * 60 * 1000)) {
    return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
  }

  const { email: rawEmail, code: rawCode } = await readJson<{ email: string; code: string }>(req)
  const email = normalizeEmail(rawEmail)
  const code = typeof rawCode === "string" ? rawCode.trim() : ""
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return Response.json({ error: "Email and 6-digit code are required" }, { status: 400 })
  }

  try {
    const pending = await prisma.passwordReset.findUnique({ where: { token: hashEmailChangeCode(user.id, email, code) } })
    if (!pending || pending.used) return INVALID()
    if (pending.expiresAt.getTime() < Date.now()) {
      await prisma.passwordReset.update({ where: { id: pending.id }, data: { used: true } })
      return Response.json({ error: "Code has expired. Please request a new one." }, { status: 400 })
    }

    // Someone may have registered the address since the code was sent
    const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (taken && taken.id !== user.id) {
      return Response.json({ error: "Email already in use by another account" }, { status: 409 })
    }

    const before = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } })
    if (!before) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { email, emailVerified: new Date() },
        select: { id: true, email: true, name: true, image: true },
      }),
      prisma.passwordReset.update({ where: { id: pending.id }, data: { used: true } }),
    ])

    if (before.email !== email) {
      after(() => sendEmailChangedNotice(before.email, email).catch((err) => console.error("[confirm-email] notice failed", err)))
    }
    return Response.json(updated)
  } catch (err) {
    // Unique-constraint race with a concurrent registration of the same address
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return Response.json({ error: "Email already in use by another account" }, { status: 409 })
    }
    console.error(err)
    return Response.json({ error: "Failed to update email" }, { status: 500 })
  }
}
