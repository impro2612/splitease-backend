import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { pusherServer } from "@/lib/pusher"
import { checkRateLimit } from "@/lib/rate-limit"
import { parseOptionalDate } from "@/lib/request"

class PaymentError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

// POST /api/borrow-book/[id]/payments — record a partial payment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (!await checkRateLimit(`borrow-payment:${user.id}`, 30, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }

  const { id } = await params
  const { amount, date, note } = await req.json().catch(() => ({}))

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: "Positive amount required" }, { status: 400 })
  }
  const paymentDate = parseOptionalDate(date)
  if (paymentDate === undefined) return Response.json({ error: "Invalid date" }, { status: 400 })
  if (note != null && (typeof note !== "string" || note.length > 200)) {
    return Response.json({ error: "Note is too long" }, { status: 400 })
  }
  const payAmount = Math.round(amount * 100)

  try {
    // Check-and-insert in one transaction so two concurrent payments can't both
    // fit under the remaining balance and overpay the IOU.
    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.borrowEntry.findFirst({
        where: { id, OR: [{ lenderId: user.id }, { borrowerId: user.id }], status: "PENDING" },
        include: {
          payments: true,
          lender: { select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } } },
          borrower: { select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } } },
        },
      })
      if (!entry) throw new PaymentError("Entry not found or already settled", 404)

      const paidSoFar = entry.payments.reduce((s, p) => s + p.amount, 0)
      if (paidSoFar + payAmount > entry.amount) throw new PaymentError("Payment exceeds remaining balance")

      const payment = await tx.borrowPayment.create({
        data: { entryId: id, amount: payAmount, date: paymentDate ?? new Date(), note: note?.trim() || null },
      })

      // Auto-settle only when the lender records/confirms the final payment.
      // Borrowers can add payments, but lender confirmation is required to settle.
      const newTotal = paidSoFar + payAmount
      const isLender = entry.lenderId === user.id
      const autoSettled = newTotal >= entry.amount && isLender
      if (autoSettled) {
        await tx.borrowEntry.update({ where: { id }, data: { status: "SETTLED", settledAt: new Date() } })
      }
      return { entry, payment, newTotal, isLender, autoSettled }
    })

    const { entry, payment, newTotal, isLender, autoSettled } = result

    after(() => pusherServer.trigger(
      [`private-user-${entry.lenderId}`, `private-user-${entry.borrowerId}`],
      "iou-updated",
      {},
    ).catch(() => {}))

    // Notify the other person
    const otherUser = isLender ? entry.borrower : entry.lender
    const myName = getDisplayName(user)
    const amtStr = `${payAmount / 100} ${entry.currency}`
    const isBorrowerFullPayment = !isLender && newTotal >= entry.amount
    const [title, body] = autoSettled
      ? ["✅ IOU Settled", `${myName} confirmed full payment received — IOU settled!`]
      : isBorrowerFullPayment
        ? ["💳 Full Payment Made", `${myName} has paid ${amtStr} in full — please confirm to settle`]
        : isLender
          ? ["💰 Part Payment Recorded", `${myName} recorded a payment of ${amtStr}`]
          : ["💰 Part Payment", `${myName} made a payment of ${amtStr}`]
    after(() => notifyUsers([otherUser], title, body, { type: "iou_payment", url: buildAppUrl("borrow-book") }).catch(() => {}))

    return Response.json({ ...payment, amount: payment.amount / 100 }, { status: 201 })
  } catch (err) {
    if (err instanceof PaymentError) return Response.json({ error: err.message }, { status: err.status })
    console.error(err)
    return Response.json({ error: "Failed to record payment" }, { status: 500 })
  }
}
