import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

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

  return Response.json({ friends: accepted, incoming, outgoing })
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

    if (existing) return Response.json({ error: "Friend request already exists" }, { status: 409 })

    const friend = await prisma.friend.create({
      data: { requesterId: user.id, addresseeId },
    })

    return Response.json(friend, { status: 201 })
  } catch (err) {
    return Response.json({ error: "Failed to send friend request" }, { status: 500 })
  }
}
