import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { pusherServer } from "@/lib/pusher"
import { checkRateLimit } from "@/lib/rate-limit"
import { isSingleEmoji } from "@/lib/request"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id) // chat is part of SplitIT Plus
  if (locked) return locked

  const { messageId } = await params
  const { emoji } = await req.json().catch(() => ({ emoji: undefined }))

  if (!await checkRateLimit(`reactions:${user.id}`, 60, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }
  // One emoji grapheme — accepts ZWJ families, skin tones and flags
  if (!isSingleEmoji(emoji)) {
    return Response.json({ error: "Invalid emoji" }, { status: 400 })
  }

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      OR: [
        { senderId: user.id },
        { receiverId: user.id },
      ],
    },
    select: { id: true, senderId: true, receiverId: true },
  })
  if (!message) return Response.json({ error: "Message not found" }, { status: 404 })

  const existing = await prisma.messageReaction.findFirst({
    where: { messageId, userId: user.id, emoji },
  })

  let action: "added" | "removed"
  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } })
    action = "removed"
  } else {
    await prisma.messageReaction.create({
      data: { messageId, userId: user.id, emoji },
    })
    action = "added"
  }

  // Notify both participants
  const otherUserId = message.senderId === user.id ? message.receiverId : message.senderId
  await Promise.all([
    pusherServer.trigger(`private-user-${user.id}`, "message-reaction", {
      messageId, emoji, userId: user.id, action,
    }).catch(() => {}),
    pusherServer.trigger(`private-user-${otherUserId}`, "message-reaction", {
      messageId, emoji, userId: user.id, action,
    }).catch(() => {}),
  ])

  return Response.json({ action, messageId, emoji, userId: user.id })
}
