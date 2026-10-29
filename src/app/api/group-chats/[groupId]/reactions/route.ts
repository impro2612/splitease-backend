import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { isSingleEmoji } from "@/lib/request"
import { chatMember, signalGroup } from "@/lib/group-chat"

// POST /api/group-chats/:groupId/reactions — { messageId, emoji } toggles your reaction
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  if (!await checkRateLimit(`reactions:${user.id}`, 60, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }

  const { groupId } = await params
  const { messageId, emoji } = await req.json().catch(() => ({}))
  if (typeof messageId !== "string" || !isSingleEmoji(emoji)) {
    return Response.json({ error: "Invalid reaction" }, { status: 400 })
  }

  const me = await chatMember(groupId, user.id)
  if (!me || me.chatLeft) return Response.json({ error: "Not in this chat" }, { status: 403 })
  const message = await prisma.groupMessage.findFirst({ where: { id: messageId, groupId, deleted: false }, select: { id: true } })
  if (!message) return Response.json({ error: "Message not found" }, { status: 404 })

  const existing = await prisma.groupMessageReaction.findFirst({ where: { messageId, userId: user.id, emoji } })
  let action: "added" | "removed"
  if (existing) {
    await prisma.groupMessageReaction.delete({ where: { id: existing.id } })
    action = "removed"
  } else {
    await prisma.groupMessageReaction.create({ data: { messageId, userId: user.id, emoji } })
    action = "added"
  }

  await signalGroup(groupId, "group-message-reaction", { messageId, emoji, userId: user.id, action })
  return Response.json({ action, messageId, emoji, userId: user.id })
}
