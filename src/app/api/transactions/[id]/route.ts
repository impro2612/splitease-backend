import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { CATEGORIES } from "@/lib/categorize"

type Params = { params: Promise<{ id: string }> }

// PATCH /api/transactions/[id]  — override category
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { category } = await req.json()

  if (!CATEGORIES.includes(category)) {
    return Response.json({ error: "Invalid category" }, { status: 400 })
  }

  const txn = await prisma.personalTransaction.findUnique({ where: { id } })
  if (!txn || txn.userId !== user.id) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const updated = await prisma.personalTransaction.update({
    where: { id },
    data: { category },
  })

  return Response.json({ ...updated, amount: updated.amount / 100 })
}

// DELETE /api/transactions/[id]
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const txn = await prisma.personalTransaction.findUnique({ where: { id } })
  if (!txn || txn.userId !== user.id) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.personalTransaction.delete({ where: { id } })
  return Response.json({ success: true })
}
