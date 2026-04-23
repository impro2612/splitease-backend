import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const userId = user.id

  const friends = await prisma.friend.findMany({
    where: {
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: {
      requester: { select: { id: true, name: true, email: true, image: true } },
      addressee: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  const accepted = friends.filter((f) => f.status === "ACCEPTED")
  const incoming = friends.filter((f) => f.status === "PENDING" && f.addresseeId === userId)
  const outgoing = friends.filter((f) => f.status === "PENDING" && f.requesterId === userId)

  const friendIds = accepted.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId))
  const unreadRows = friendIds.length === 0
    ? []
    : await prisma.message.findMany({
        where: {
          receiverId: userId,
          senderId: { in: friendIds },
          read: false,
          deleted: false,
        },
        select: { senderId: true },
        distinct: ["senderId"],
      })

  const unreadByFriend = Object.fromEntries(
    unreadRows.map((row) => [row.senderId, 1])
  )

  return Response.json({ friends: accepted, incoming, outgoing, unreadByFriend })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { addresseeId } = await req.json()

    const existing = await prisma.friend.findFirst({
      where: {
        OR: [
          { requesterId: user.id, addresseeId },
          { requesterId: addresseeId, addresseeId: user.id },
        ],
      },
    })

    let friend

    if (existing?.status === "ACCEPTED" || existing?.status === "PENDING") {
      return Response.json({ error: "Friend request already exists" }, { status: 409 })
    }

    if (existing) {
      friend = await prisma.friend.update({
        where: { id: existing.id },
        data: {
          requesterId: user.id,
          addresseeId,
          status: "PENDING",
          createdAt: new Date(),
        },
      })
    } else {
      friend = await prisma.friend.create({
        data: { requesterId: user.id, addresseeId },
      })
    }

    const addressee = await prisma.user.findUnique({
      where: { id: addresseeId },
      select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
    })
    if (addressee) {
      await notifyUsers([addressee], "New friend request", `${getDisplayName(user)} sent you a friend request.`, {
        type: "friend_request",
        friendRequestId: friend.id,
        url: buildAppUrl("friends"),
      })
    }

    return Response.json(friend, { status: 201 })
  } catch (err) {
    return Response.json({ error: "Failed to send friend request" }, { status: 500 })
  }
}
