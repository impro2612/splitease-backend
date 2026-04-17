import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// GET /api/messages/[friendId]?after=<ISO>&limit=<n>
// Returns messages between current user and friendId, newest first
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { friendId } = await params

  // Enforce friendship — same check as POST /api/messages
  const friendship = await prisma.friend.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: user.id, addresseeId: friendId },
        { requesterId: friendId, addresseeId: user.id },
      ],
    },
  })
  if (!friendship) return Response.json({ error: "Not friends" }, { status: 403 })

  const url = new URL(req.url)
  const after = url.searchParams.get("after") // ISO date string for delta sync
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100)
  const before = url.searchParams.get("before") // clientId cursor for pagination

  const whereBase = {
    OR: [
      { senderId: user.id, receiverId: friendId },
      { senderId: friendId, receiverId: user.id },
    ],
    deleted: false,
  }

  const messages = await prisma.message.findMany({
    where: {
      ...whereBase,
      ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      ...(before
        ? {
            createdAt: {
              lt: await prisma.message
                .findUnique({ where: { clientId: before } })
                .then((m) => m?.createdAt ?? new Date()),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      senderId: true,
      receiverId: true,
      content: true,
      clientId: true,
      read: true,
      createdAt: true,
    },
  })

  // Mark unread messages sent to us as read
  const unreadIds = messages
    .filter((m) => m.receiverId === user.id && !m.read)
    .map((m) => m.id)

  if (unreadIds.length > 0) {
    await prisma.message.updateMany({
      where: { id: { in: unreadIds } },
      data: { read: true },
    })
  }

  return Response.json({ messages, hasMore: messages.length === limit })
}
