import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// DELETE /api/spend-diary/[id]/entries/[entryId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id, entryId } = await params
  const diary = await prisma.spendDiary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return Response.json({ error: "Not found" }, { status: 404 })

  await prisma.spendEntry.deleteMany({ where: { id: entryId, diaryId: id } })
  return Response.json({ success: true })
}
