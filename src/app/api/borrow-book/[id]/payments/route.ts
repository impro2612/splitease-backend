import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// POST /api/borrow-book/[id]/payments — record a partial payment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { amount, date, note } = await req.json()

  if (!amount || amount <= 0) {
    return Response.json({ error: "Positive amount required" }, { status: 400 })
  }

  const entry = await prisma.borrowEntry.findFirst({
    where: {
      id,
      OR: [{ lenderId: user.id }, { borrowerId: user.id }],
      status: "PENDING",
    },
    include: { payments: true },
  })
  if (!entry) return Response.json({ error: "Entry not found or already settled" }, { status: 404 })

  const paidSoFar = entry.payments.reduce((s, p) => s + p.amount, 0)
  const payAmount = Math.round(amount * 100)

  if (paidSoFar + payAmount > entry.amount) {
    return Response.json({ error: "Payment exceeds remaining balance" }, { status: 400 })
  }

  const payment = await prisma.borrowPayment.create({
    data: {
      entryId: id,
      amount: payAmount,
      date: date ? new Date(date) : new Date(),
      note: note ?? null,
    },
  })

  // Auto-settle only when the lender records/confirms the final payment.
  // Borrowers can add payments, but lender confirmation is required to settle.
  const newTotal = paidSoFar + payAmount
  if (newTotal >= entry.amount && entry.lenderId === user.id) {
    await prisma.borrowEntry.update({
      where: { id },
      data: { status: "SETTLED", settledAt: new Date() },
    })
  }

  return Response.json({ ...payment, amount: payment.amount / 100 }, { status: 201 })
}
