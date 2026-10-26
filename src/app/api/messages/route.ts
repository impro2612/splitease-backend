import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { pusherServer } from "@/lib/pusher"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { checkRateLimit } from "@/lib/rate-limit"

// POST /api/messages — send a message
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id) // chat is part of SplitIT Plus
  if (locked) return locked

  // 60 messages per minute per user
  if (!await checkRateLimit(`messages:${user.id}`, 60, 60 * 1000)) {
    return Response.json({ error: "Too many messages. Please slow down." }, { status: 429 })
  }

  const { receiverId, content, clientId } = await req.json().catch(() => ({}))

  if (typeof receiverId !== "string" || !receiverId || !content || typeof clientId !== "string" || !clientId || clientId.length > 100) {
    return Response.json({ error: "Missing fields" }, { status: 400 })
  }

  if (typeof content !== "string" || content.length > 10_000) {
    return Response.json({ error: "Message too long" }, { status: 400 })
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

  // Upsert by (sender, clientId) to handle retries — scoped to the sender so a
  // guessed clientId can never return someone else's message
  const message = await prisma.message.upsert({
    where: { senderId_clientId: { senderId: user.id, clientId } },
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

  after(async () => {
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
  })

  return Response.json(message, { status: 201 })
}

// DELETE /api/messages — soft-delete own messages by ID
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id) // chat is part of SplitIT Plus
  if (locked) return locked

  const { ids } = await req.json().catch(() => ({ ids: null }))
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((i) => typeof i === "string")) {
    return Response.json({ error: "ids required" }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.message.updateMany({
      where: {
        id: { in: ids },
        senderId: user.id,
      },
      data: { senderDeleted: true },
    })

    await tx.message.updateMany({
      where: {
        id: { in: ids },
        receiverId: user.id,
      },
      data: { receiverDeleted: true },
    })

    await tx.message.updateMany({
      where: {
        id: { in: ids },
        senderDeleted: true,
        receiverDeleted: true,
      },
      data: { deleted: true },
    })
  })

  return Response.json({ ok: true }, { status: 200 })
}
