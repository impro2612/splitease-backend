import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { EMAIL_RE, normalizeEmail } from "@/lib/email"
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

    let sharedGroupIds: string[] = []
    await prisma.$transaction(async (tx) => {
      const uid = user.id

      // Groups where this user is the only member are purely personal — remove them
      const memberships = await tx.groupMember.findMany({
        where: { userId: uid },
        select: { groupId: true, group: { select: { _count: { select: { members: true } } } } },
      })
      const soloGroupIds = memberships.filter((m) => m.group._count.members <= 1).map((m) => m.groupId)
      if (soloGroupIds.length) await tx.group.deleteMany({ where: { id: { in: soloGroupIds } } })

      // Shared groups: hand admin/ownership to a remaining member, keep the ghost as a plain member
      const shared = memberships.filter((m) => !soloGroupIds.includes(m.groupId)).map((m) => m.groupId)
      sharedGroupIds = shared
      for (const groupId of shared) {
        const otherAdmins = await tx.groupMember.count({ where: { groupId, role: "ADMIN", userId: { not: uid } } })
        if (otherAdmins === 0) {
          const heir = await tx.groupMember.findFirst({
            where: { groupId, userId: { not: uid } },
            orderBy: { joinedAt: "asc" },
          })
          if (heir) await tx.groupMember.update({ where: { id: heir.id }, data: { role: "ADMIN" } })
        }
        await tx.groupMember.updateMany({ where: { groupId, userId: uid }, data: { role: "MEMBER" } })
        const group = await tx.group.findUnique({ where: { id: groupId }, select: { createdById: true } })
        if (group?.createdById === uid) {
          const heir = await tx.groupMember.findFirst({ where: { groupId, userId: { not: uid } }, orderBy: { joinedAt: "asc" } })
          if (heir) await tx.group.update({ where: { id: groupId }, data: { createdById: heir.userId } })
        }
      }

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
    })

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

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) return Response.json({ error: "Name cannot be empty" }, { status: 400 })
      if (name.trim().length > 100) return Response.json({ error: "Name is too long" }, { status: 400 })
      updateData.name = name.trim()
    }

    if (email !== undefined) {
      if (!email?.trim()) return Response.json({ error: "Email cannot be empty" }, { status: 400 })
      const normalized = normalizeEmail(email)
      if (!EMAIL_RE.test(normalized)) {
        return Response.json({ error: "Invalid email format" }, { status: 400 })
      }
      const existing = await prisma.user.findUnique({ where: { email: normalized } })
      if (existing && existing.id !== user.id) {
        return Response.json({ error: "Email already in use by another account" }, { status: 409 })
      }
      updateData.email = normalized
    }

    if (newPassword !== undefined) {
      if (!currentPassword) return Response.json({ error: "Current password is required" }, { status: 400 })
      // Throttle current-password guesses from a hijacked session
      if (!await checkRateLimit(`password-change:${user.id}`, 5, 15 * 60 * 1000)) {
        return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 })
      }
      if (newPassword.length < 8) return Response.json({ error: "New password must be at least 8 characters" }, { status: 400 })
      if (!/\d/.test(newPassword)) return Response.json({ error: "New password must contain at least one number" }, { status: 400 })

      const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true } })
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

    if (Object.keys(updateData).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: { id: true, email: true, name: true, image: true },
    })
    return Response.json(updated)
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to update profile" }, { status: 500 })
  }
}
