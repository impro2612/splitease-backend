import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// DELETE /api/blocks/:userId — unblock a user
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { userId } = await params

  await prisma.block.deleteMany({
    where: { blockerId: user.id, blockedId: userId },
  })

  return Response.json({ ok: true })
}
