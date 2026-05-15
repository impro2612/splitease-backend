import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

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
  if (entry.status === "SETTLED") return Response.json({ error: "Already settled" }, { status: 400 })

  const updated = await prisma.borrowEntry.update({
    where: { id },
    data: { status: "SETTLED", settledAt: new Date() },
    include: {
      lender:   { select: { id: true, name: true, email: true, image: true } },
      borrower: { select: { id: true, name: true, email: true, image: true } },
    },
  })

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

  await prisma.borrowEntry.delete({ where: { id } })
  return Response.json({ success: true })
}
