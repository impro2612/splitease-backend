import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { pusherServer } from "@/lib/pusher"

type EntryWithUsers = Prisma.BorrowEntryGetPayload<{
  include: {
    lender: { select: { id: true; name: true; email: true; image: true } }
    borrower: { select: { id: true; name: true; email: true; image: true } }
  }
}>

function toApi(e: EntryWithUsers) {
  return { ...e, amount: e.amount / 100 }
}

// PATCH /api/borrow-book/[id] — settle entry
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const entry = await prisma.borrowEntry.findFirst({
    where: {
      id,
      OR: [{ lenderId: user.id }, { borrowerId: user.id }],
    },
  })
  if (!entry) return Response.json({ error: "Entry not found" }, { status: 404 })
  if (entry.lenderId !== user.id) {
    return Response.json({ error: "Only the lender can mark this entry as settled" }, { status: 403 })
  }
  if (entry.status === "SETTLED") return Response.json({ error: "Already settled" }, { status: 400 })

  const updated = await prisma.borrowEntry.update({
    where: { id },
    data: { status: "SETTLED", settledAt: new Date() },
    include: {
      lender:   { select: { id: true, name: true, email: true, image: true } },
      borrower: { select: { id: true, name: true, email: true, image: true } },
    },
  })

  // Push real-time update to both parties
  pusherServer.trigger(
    [`private-user-${user.id}`, `private-user-${updated.borrowerId}`],
    "iou-updated",
    {},
  ).catch(() => {})

  // Notify borrower that the debt is cleared
  const borrower = await prisma.user.findUnique({
    where: { id: updated.borrowerId },
    select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
  })
  if (borrower) {
    notifyUsers(
      [borrower],
      "✅ IOU Settled",
      `${getDisplayName(user)} marked your debt as settled`,
      { type: "iou_settled", url: buildAppUrl("borrow-book") },
    ).catch(() => {})
  }

  return Response.json(toApi(updated))
}

// DELETE /api/borrow-book/[id] — delete entry (only lender can delete)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const entry = await prisma.borrowEntry.findFirst({
    where: {
      id,
      OR: [{ lenderId: user.id }, { borrowerId: user.id }],
    },
  })
  if (!entry) return Response.json({ error: "Entry not found" }, { status: 404 })
  if (entry.lenderId !== user.id) {
    return Response.json({ error: "Only the lender can delete this entry" }, { status: 403 })
  }

  // Fetch borrower's push token before deleting
  const borrowerWithToken = await prisma.user.findUnique({
    where: { id: entry.borrowerId },
    select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
  })

  await prisma.borrowEntry.delete({ where: { id } })

  // Push real-time update to both parties
  pusherServer.trigger(
    [`private-user-${user.id}`, `private-user-${entry.borrowerId}`],
    "iou-updated",
    {},
  ).catch(() => {})

  if (borrowerWithToken) {
    const amtStr = `${entry.amount / 100} ${entry.currency}`
    notifyUsers(
      [borrowerWithToken],
      "🗑️ IOU Removed",
      `${getDisplayName(user)} removed an IOU of ${amtStr}`,
      { type: "iou_deleted", url: buildAppUrl("borrow-book") },
    ).catch(() => {})
  }

  return Response.json({ success: true }, { status: 200 })
}
