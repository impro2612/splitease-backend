import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { pusherServer } from "@/lib/pusher"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"

// POST /api/messages — send a message
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { receiverId, content, clientId } = await req.json()

  if (!receiverId || !content || !clientId) {
    return Response.json({ error: "Missing fields" }, { status: 400 })
  }

  // Check they are friends and neither has blocked the other
  const [friendship, block] = await Promise.all([
    prisma.friend.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: user.id, addresseeId: receiverId },
          { requesterId: receiverId, addresseeId: user.id },
        ],
      },
    }),
    prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: user.id, blockedId: receiverId },
          { blockerId: receiverId, blockedId: user.id },
        ],
      },
    }),
  ])
  if (!friendship) return Response.json({ error: "Not friends" }, { status: 403 })
  if (block) return Response.json({ error: "Blocked" }, { status: 403 })

  // Upsert by clientId to handle retries
  const message = await prisma.message.upsert({
    where: { clientId },
    update: {},
    create: {
      senderId: user.id,
      receiverId,
      content,
      clientId,
    },
  })

  // Ping receiver via Pusher (no content — just a new-message signal)
  await pusherServer.trigger(`private-user-${receiverId}`, "new-message", {
    senderId: user.id,
    clientId: message.clientId,
  }).catch(() => {}) // non-fatal

  const receiver = await prisma.user.findUnique({
    where: { id: receiverId },
    select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
  })
  if (receiver) {
    await notifyUsers([receiver], getDisplayName(user), "Sent you a message", {
      type: "chat_message",
      friendId: user.id,
      url: buildAppUrl(`chat/${user.id}`, { name: user.name ?? user.email }),
    })
  }

  return Response.json(message, { status: 201 })
}

// DELETE /api/messages — soft-delete own messages by ID
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { ids } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: "ids required" }, { status: 400 })
  }

  await prisma.message.updateMany({
    where: {
      id: { in: ids },
      OR: [{ senderId: user.id }, { receiverId: user.id }],
    },
    data: { deleted: true },
  })

  return Response.json({ ok: true })
}
