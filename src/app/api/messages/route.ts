import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { pusherServer } from "@/lib/pusher"

// POST /api/messages — send a message
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { receiverId, content, clientId } = await req.json()

  if (!receiverId || !content || !clientId) {
    return Response.json({ error: "Missing fields" }, { status: 400 })
  }

  // Check they are friends
  const friendship = await prisma.friend.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: user.id, addresseeId: receiverId },
        { requesterId: receiverId, addresseeId: user.id },
      ],
    },
  })
  if (!friendship) {
    return Response.json({ error: "Not friends" }, { status: 403 })
  }

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
  await pusherServer.trigger(`user-${receiverId}`, "new-message", {
    senderId: user.id,
    clientId: message.clientId,
  }).catch(() => {}) // non-fatal

  return Response.json(message, { status: 201 })
}
