import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { getNetPerPerson } from "@/lib/balance"
import { logActivity } from "@/lib/activity"
import { geocode } from "@/lib/geocode"
import { checkRateLimit } from "@/lib/rate-limit"
import { COLOR_RE, CURRENCY_RE, isOptionalString, isSingleEmoji, readJson, type JsonBody } from "@/lib/request"
import { isAllowedImageUrl, parseCredit } from "@/lib/group-image"
import { deleteGroupPhotoIfUnused, groupPhotoIdFromUrl } from "@/lib/group-photo"
import { expenseToApi } from "@/lib/expense-api"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const group = await prisma.group.findFirst({
    where: {
      id,
      members: { some: { userId: user.id } },
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      },
      expenses: {
        include: {
          paidBy: { select: { id: true, name: true, email: true, image: true } },
          splits: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
          reactions: {
            select: { id: true, userId: true, emoji: true },
          },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      },
      settlements: {
        include: {
          fromUser: { select: { id: true, name: true, email: true, image: true } },
          toUser: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  })

  if (!group) return Response.json({ error: "Group not found" }, { status: 404 })

  return Response.json({
    ...group,
    expenses: group.expenses.map(expenseToApi),
    settlements: group.settlements.map((s) => ({ ...s, amount: s.amount / 100 })),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { name, description, emoji, color, currency, location, lat, lng, startDate, endDate, imageUrl, imageCredit } = await readJson<JsonBody>(req)
  // A photo replaces the emoji tile; null clears it (back to the emoji)
  if (imageUrl !== undefined && imageUrl !== null && !isAllowedImageUrl(imageUrl)) {
    return Response.json({ error: "Unsupported image" }, { status: 400 })
  }

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: user.id } },
  })

  if (!member || member.role !== "ADMIN") {
    return Response.json({ error: "Only admins can edit groups" }, { status: 403 })
  }

  const existingGroup = await prisma.group.findUnique({
    where: { id },
    select: { name: true, emoji: true, currency: true, imageUrl: true, _count: { select: { expenses: true, settlements: true } } },
  })
  if (!existingGroup) return Response.json({ error: "Group not found" }, { status: 404 })

  if (currency !== undefined) {
    if (typeof currency !== "string" || !CURRENCY_RE.test(currency)) {
      return Response.json({ error: "Invalid currency" }, { status: 400 })
    }
    const hasMoneyActivity = existingGroup._count.expenses > 0 || existingGroup._count.settlements > 0
    if (hasMoneyActivity && currency !== existingGroup.currency) {
      return Response.json(
        { error: "Cannot change currency after expenses or settlements exist" },
        { status: 400 }
      )
    }
  }

  const patchStartDate = startDate === undefined || startDate === null || startDate === ""
    ? null
    : new Date(startDate)
  const patchEndDate = endDate === undefined || endDate === null || endDate === ""
    ? null
    : new Date(endDate)

  if (startDate !== undefined && patchStartDate && isNaN(patchStartDate.getTime())) {
    return Response.json({ error: "Invalid startDate" }, { status: 400 })
  }
  if (endDate !== undefined && patchEndDate && isNaN(patchEndDate.getTime())) {
    return Response.json({ error: "Invalid endDate" }, { status: 400 })
  }
  if (patchStartDate && patchEndDate && patchStartDate > patchEndDate) {
    return Response.json({ error: "endDate must be on or after startDate" }, { status: 400 })
  }

  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 100)) {
    return Response.json({ error: "Invalid name" }, { status: 400 })
  }
  if (!isOptionalString(description, 500)) return Response.json({ error: "Description is too long (max 500 characters)" }, { status: 400 })
  if (emoji !== undefined && !isSingleEmoji(emoji)) return Response.json({ error: "Emoji must be a single emoji" }, { status: 400 })
  if (color !== undefined && (typeof color !== "string" || !COLOR_RE.test(color))) {
    return Response.json({ error: "Color must be a hex value like #6366f1" }, { status: 400 })
  }
  if (!isOptionalString(location, 120)) return Response.json({ error: "Location is too long" }, { status: 400 })

  // Coordinates follow the location: a changed location without coordinates is
  // re-geocoded, and clearing the location clears the map pin.
  let locationData: { location?: string | null; lat?: number | null; lng?: number | null } = {}
  if (location !== undefined) {
    const place = typeof location === "string" && location.trim() ? location.trim() : null
    let pLat = typeof lat === "number" && Number.isFinite(lat) ? lat : null
    let pLng = typeof lng === "number" && Number.isFinite(lng) ? lng : null
    // Over the per-user Nominatim quota: save the place without a pin rather than fail
    if (place && (pLat === null || pLng === null) && await checkRateLimit(`geocode:${user.id}`, 10, 60 * 60 * 1000)) {
      const geo = await geocode(place)
      pLat = geo?.lat ?? null
      pLng = geo?.lng ?? null
    }
    locationData = { location: place, lat: place ? pLat : null, lng: place ? pLng : null }
  } else if (typeof lat === "number" && typeof lng === "number") {
    locationData = { lat, lng }
  }

  // An own-upload being replaced or cleared would otherwise sit orphaned in GroupPhoto
  const oldPhotoId = imageUrl !== undefined && imageUrl !== existingGroup.imageUrl ? groupPhotoIdFromUrl(existingGroup.imageUrl) : null

  const group = await prisma.$transaction(async (tx) => {
    const updated = await tx.group.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(emoji !== undefined && { emoji }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl as string | null, imageCredit: imageUrl ? parseCredit(imageCredit) : null }),
        ...(color !== undefined && { color }),
        ...(currency !== undefined && { currency }),
        ...locationData,
        ...(startDate !== undefined && { startDate: patchStartDate }),
        ...(endDate !== undefined && { endDate: patchEndDate }),
      },
    })
    if (oldPhotoId) await deleteGroupPhotoIfUnused(tx, oldPhotoId)
    return updated
  })

  if (name !== undefined && name !== existingGroup.name) {
    after(() => logActivity({
      type: "group_renamed",
      actorId: user.id,
      groupId: id,
      meta: { oldName: existingGroup.name, newName: group.name, groupEmoji: group.emoji },
    }))
  }

  return Response.json(group)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: user.id } },
  })

  if (!member || member.role !== "ADMIN") {
    return Response.json({ error: "Only admins can delete groups" }, { status: 403 })
  }

  const groupToDelete = await prisma.group.findUnique({
    where: { id },
    select: { name: true, emoji: true, imageUrl: true },
  })
  if (!groupToDelete) return Response.json({ error: "Group not found" }, { status: 404 })

  // Deleting a group with open balances would silently wipe what members owe each other
  // (an admin who owes money could erase their own debt), so everyone must be settled first.
  // The check and the deletes share one transaction so an expense added in between can't
  // be lost: either it's seen by the check or the delete never happens.
  const outcome = await prisma.$transaction(async (tx) => {
    const [groupExpenses, groupSettlements] = await Promise.all([
      tx.expense.findMany({ where: { groupId: id }, select: { currency: true, paidById: true, splits: { select: { userId: true, amount: true, paid: true } } } }),
      tx.settlement.findMany({ where: { groupId: id }, select: { currency: true, fromUserId: true, toUserId: true, amount: true } }),
    ])
    for (const currency of new Set([...groupExpenses.map((e) => e.currency), ...groupSettlements.map((x) => x.currency)])) {
      const nets = getNetPerPerson(
        groupExpenses.filter((e) => e.currency === currency),
        groupSettlements.filter((x) => x.currency === currency),
        true
      )
      if ([...nets.values()].some((cents) => cents !== 0)) return "unsettled" as const
    }

    // The group's chat goes with it (explicit, in case FK cascades aren't enforced)
    await tx.groupMessageReaction.deleteMany({ where: { message: { groupId: id } } })
    await tx.groupMessage.deleteMany({ where: { groupId: id } })
    await tx.group.delete({ where: { id } })
    // ...and its own uploaded photo, unless another group copied the URL
    const photoId = groupPhotoIdFromUrl(groupToDelete.imageUrl)
    if (photoId) await deleteGroupPhotoIfUnused(tx, photoId)
    return "deleted" as const
  }, { timeout: 15_000 })

  if (outcome === "unsettled") {
    return Response.json({ error: "Some members still owe money in this group. Settle all balances before deleting it." }, { status: 409 })
  }
  // Logged after the commit (logActivity uses its own connection, which must not write
  // while the transaction holds the lock). No groupId: the group is gone and the FK's
  // onDelete: SetNull would have nulled it anyway.
  await logActivity({
    type: "group_deleted",
    actorId: user.id,
    meta: { groupName: groupToDelete.name, groupEmoji: groupToDelete.emoji },
  })
  return Response.json({ success: true }, { status: 200 })
}
