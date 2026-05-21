import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// PATCH /api/spend-diary/[id] — rename diary
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { title } = await req.json()
  if (!title?.trim()) return Response.json({ error: "title required" }, { status: 400 })

  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.spendDiary.update({
    where: { id },
    data: { title: title.trim(), updatedAt: new Date() },
  })
  return Response.json(updated)
}

// DELETE /api/spend-diary/[id] — delete diary and all entries
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  await prisma.spendDiary.delete({ where: { id } })
  return Response.json({ success: true })
}
