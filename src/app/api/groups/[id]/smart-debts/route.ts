import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { logActivity } from "@/lib/activity"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await params

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  // Switching how the whole group's debts are presented is an admin decision
  if (!member || member.role !== "ADMIN") {
    return Response.json({ error: "Only admins can change Smart Debts" }, { status: 403 })
  }

  const { enabled } = await req.json().catch(() => ({ enabled: undefined }))
  if (typeof enabled !== "boolean") {
    return Response.json({ error: "enabled must be a boolean" }, { status: 400 })
  }

  const groupInfo = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, emoji: true },
  })

  const group = await prisma.group.update({
    where: { id: groupId },
    data: { smartDebtsEnabled: enabled },
    select: { smartDebtsEnabled: true },
  })

  logActivity({
    type: "smart_debts_toggled",
    actorId: user.id,
    groupId,
    meta: { enabled, groupName: groupInfo?.name, groupEmoji: groupInfo?.emoji },
  })

  return Response.json({ smartDebtsEnabled: group.smartDebtsEnabled })
}
