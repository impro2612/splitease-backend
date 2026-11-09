import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import * as crypto from "crypto"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { EMAIL_RE, maskEmail, normalizeEmail } from "@/lib/email"
import { hashEmailChangeCode } from "@/lib/reset-code"
import { sendEmailChangeCode } from "@/lib/mailer"
import { revokeAppleToken } from "@/lib/apple"
import { readJson, type JsonBody } from "@/lib/request"
import { getDisplayName } from "@/lib/notify"
import { DELETED_USER_NAME, scrubActivityMeta } from "@/lib/activity-scrub"

// DELETE /api/auth/me — delete account.
// Shared group history (expenses, splits, settlements) belongs to the other members too,
// so the user row is anonymised into a "Deleted user" ghost instead of being removed:
// everyone else's balances stay correct, while all personal data, credentials and
// private content are erased.
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    // Apple requires revoking Sign in with Apple when the account is deleted (best effort:
    // a failed revoke must not block the user from deleting their account)
    const before = await prisma.user.findUnique({ where: { id: user.id }, select: { appleRefreshToken: true, name: true, email: true } })
    if (before?.appleRefreshToken) await revokeAppleToken(before.appleRefreshToken)
    const oldDisplayName = before ? getDisplayName({ id: user.id, name: before.name, email: before.email }) : null

    // Work out group hand-overs BEFORE the transaction so it only holds writes: Turso
    // round trips inside an interactive transaction otherwise push big accounts past
    // Prisma's 5 s default and the whole deletion rolls back with a 500.
    const memberships = await prisma.groupMember.findMany({
      where: { userId: user.id },
      select: { groupId: true, group: { select: { createdById: true, _count: { select: { members: true } } } } },
    })
    // Groups where this user is the only member are purely personal — remove them
    const soloGroupIds = memberships.filter((m) => m.group._count.members <= 1).map((m) => m.groupId)
    const sharedGroupIds = memberships.filter((m) => !soloGroupIds.includes(m.groupId)).map((m) => m.groupId)
    // Shared groups: hand admin/ownership to the longest-standing remaining member
    const others = sharedGroupIds.length
      ? await prisma.groupMember.findMany({
          where: { groupId: { in: sharedGroupIds }, userId: { not: user.id } },
          select: { id: true, groupId: true, userId: true, role: true, joinedAt: true },
          orderBy: { joinedAt: "asc" },
        })
      : []
    const heirRows: string[] = []        // groupMember ids to promote to ADMIN
    const ownerHandover: { groupId: string; userId: string }[] = []
    for (const groupId of sharedGroupIds) {
      const members = others.filter((m) => m.groupId === groupId)
      const heir = members[0]
      if (!heir) continue
      if (!members.some((m) => m.role === "ADMIN")) heirRows.push(heir.id)
      const createdById = memberships.find((m) => m.groupId === groupId)?.group.createdById
      if (createdById === user.id) ownerHandover.push({ groupId, userId: heir.userId })
    }

    await prisma.$transaction(async (tx) => {
      const uid = user.id

      if (soloGroupIds.length) await tx.group.deleteMany({ where: { id: { in: soloGroupIds } } })
      if (heirRows.length) await tx.groupMember.updateMany({ where: { id: { in: heirRows } }, data: { role: "ADMIN" } })
      if (sharedGroupIds.length) await tx.groupMember.updateMany({ where: { userId: uid, groupId: { in: sharedGroupIds } }, data: { role: "MEMBER" } })
      for (const h of ownerHandover) await tx.group.update({ where: { id: h.groupId }, data: { createdById: h.userId } })

      // Private content and relationships
      await tx.friend.deleteMany({ where: { OR: [{ requesterId: uid }, { addresseeId: uid }] } })
      await tx.message.deleteMany({ where: { OR: [{ senderId: uid }, { receiverId: uid }] } })
      // Group chat rows stay (other members' threads reference them) but lose their content
      await tx.groupMessage.updateMany({ where: { senderId: uid }, data: { deleted: true, content: "" } })
      await tx.block.deleteMany({ where: { OR: [{ blockerId: uid }, { blockedId: uid }] } })
      await tx.borrowEntry.deleteMany({ where: { OR: [{ lenderId: uid }, { borrowerId: uid }] } })
      await tx.personalTransaction.deleteMany({ where: { userId: uid } })
      await tx.personalBudget.deleteMany({ where: { userId: uid } })
      await tx.personalSuggestion.deleteMany({ where: { userId: uid } })
      await tx.trip.deleteMany({ where: { userId: uid } })
      await tx.spendDiary.deleteMany({ where: { userId: uid } })
      await tx.pushDevice.deleteMany({ where: { userId: uid } })
      await tx.mobileRefreshToken.deleteMany({ where: { userId: uid } })
      await tx.session.deleteMany({ where: { userId: uid } })
      await tx.account.deleteMany({ where: { userId: uid } })
      await tx.passwordReset.deleteMany({ where: { email: user.email } })

      // Anonymise the row itself — no credentials, no PII, cannot sign in again
      await tx.user.update({
        where: { id: uid },
        data: {
          name: DELETED_USER_NAME,
          email: `deleted-${uid}@deleted.invalid`,
          password: null,
          googleId: null,
          appleId: null,
          appleRefreshToken: null,
          phone: null,
          phoneNormalized: null,
          image: null,
          emailVerified: null,
        },
      })
    }, { timeout: 30_000, maxWait: 10_000 })

    // Display names captured in the activity feed. Best effort, outside the transaction
    // so a large history can't push the account deletion past the transaction timeout.
    if (oldDisplayName) {
      try {
        await scrubActivityNames(user.id, oldDisplayName, sharedGroupIds)
      } catch (err) {
        console.error("[me/DELETE] activity scrub failed:", err)
      }
    }

    return Response.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to delete account" }, { status: 500 })
  }
}

async function scrubActivityNames(uid: string, oldName: string, groupIds: string[]) {
  // The name as it appears inside the JSON string (quotes/backslashes escaped)
  const needle = JSON.stringify(oldName).slice(1, -1)
  const rows = await prisma.activity.findMany({
    where: {
      OR: [
        { targetUserId: uid },
        { actorId: uid, meta: { contains: needle } },
        ...(groupIds.length ? [{ groupId: { in: groupIds }, meta: { contains: needle } }] : []),
      ],
    },
    select: { id: true, meta: true, targetUserId: true },
  })
  const updates = rows.flatMap((r) => {
    const meta = scrubActivityMeta(r.meta, oldName, r.targetUserId === uid)
    return meta === null ? [] : [{ id: r.id, meta }]
  })
  for (let i = 0; i < updates.length; i += 50) {
    await prisma.$transaction(updates.slice(i, i + 50).map((u) => prisma.activity.update({ where: { id: u.id }, data: { meta: u.meta } })))
  }
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const full = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, image: true },
  })
  return Response.json(full)
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { name, email, currentPassword, newPassword, image } = await readJson<JsonBody>(req)

    const updateData: Record<string, unknown> = {}
    // Set when a verified-by-code email change was started in this request
    let pendingEmail: string | null = null

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) return Response.json({ error: "Name cannot be empty" }, { status: 400 })
      if (name.trim().length > 100) return Response.json({ error: "Name is too long" }, { status: 400 })
      updateData.name = name.trim()
    }

    // The stored email/password hash are read once; the JWT's email may be an hour stale
    const dbUser = (email !== undefined || newPassword !== undefined)
      ? await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, password: true } })
      : null
    if ((email !== undefined || newPassword !== undefined) && !dbUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (email !== undefined) {
      if (!email?.trim()) return Response.json({ error: "Email cannot be empty" }, { status: 400 })
      const normalized = normalizeEmail(email)
      if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
        return Response.json({ error: "Invalid email format" }, { status: 400 })
      }
      if (normalized !== dbUser!.email) {
        // The email is the password-reset channel, so changing it needs the current password
        // (a stolen 1-hour access token must not be enough) AND proof of control of the new
        // address (a code sent there, confirmed via /api/auth/me/confirm-email).
        if (!dbUser!.password) {
          return Response.json({ error: "Your email is managed by your Google or Apple sign-in and can't be changed here" }, { status: 400 })
        }
        if (typeof currentPassword !== "string" || !currentPassword) {
          return Response.json({ error: "Current password is required" }, { status: 400 })
        }
        if (!await checkRateLimit(`email-change:${user.id}`, 5, 15 * 60 * 1000)) {
          return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
        }
        if (!await bcrypt.compare(currentPassword, dbUser!.password)) {
          return Response.json({ error: "Current password is incorrect" }, { status: 401 })
        }
        pendingEmail = normalized
      }
    }

    if (newPassword !== undefined) {
      if (!currentPassword) return Response.json({ error: "Current password is required" }, { status: 400 })
      // Throttle current-password guesses from a hijacked session
      if (!await checkRateLimit(`password-change:${user.id}`, 5, 15 * 60 * 1000)) {
        return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
      }
      if (newPassword.length < 8) return Response.json({ error: "New password must be at least 8 characters" }, { status: 400 })
      if (!/\d/.test(newPassword)) return Response.json({ error: "New password must contain at least one number" }, { status: 400 })

      if (!dbUser?.password) return Response.json({ error: "Cannot change password for this account" }, { status: 400 })

      const valid = await bcrypt.compare(currentPassword, dbUser.password)
      if (!valid) return Response.json({ error: "Current password is incorrect" }, { status: 401 })

      updateData.password = await bcrypt.hash(newPassword, 10)
      // Revoke all mobile sessions so stolen tokens can't be reused after a password change
      await prisma.mobileRefreshToken.deleteMany({ where: { userId: user.id } })
    }

    if (image !== undefined) {
      // Profile photos are stored inline as data URIs — cap size (~1.5 MB base64)
      if (image !== null && (typeof image !== "string" || image.length > 2_000_000)) {
        return Response.json({ error: "Profile photo is too large" }, { status: 400 })
      }
      updateData.image = image
    }

    if (Object.keys(updateData).length === 0 && !pendingEmail) {
      return Response.json({ error: "Nothing to update" }, { status: 400 })
    }

    const select = { id: true, email: true, name: true, image: true } as const
    const updated = Object.keys(updateData).length
      ? await prisma.user.update({ where: { id: user.id }, data: updateData, select })
      : await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select })

    if (pendingEmail) {
      await startEmailChange(user.id, pendingEmail)
      // Same response whether or not the address is free — no account enumeration
      return Response.json({ ...updated, pendingEmail: maskEmail(pendingEmail), verificationRequired: true })
    }
    return Response.json(updated)
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to update profile" }, { status: 500 })
  }
}

// Stores a 15-minute code for the new address (a PasswordReset row keyed by a hash that is
// bound to this user + address) and mails it there. Silently does nothing when the address
// belongs to another account or the inbox has had too many codes recently.
async function startEmailChange(userId: string, newEmail: string) {
  const taken = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } })
  if (taken) return
  if (!await checkRateLimit(`email-change-send:${newEmail}`, 3, 60 * 60 * 1000)) return

  const code = crypto.randomInt(100000, 1000000).toString()
  await prisma.passwordReset.create({
    data: {
      email: newEmail,
      token: hashEmailChangeCode(userId, newEmail, code),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  })
  try {
    await sendEmailChangeCode(newEmail, code)
  } catch (err) {
    console.error("[me/PATCH] email-change code send failed", err)
  }
}
