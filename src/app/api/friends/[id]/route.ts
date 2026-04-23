import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { action } = await req.json()

  const friend = await prisma.friend.findUnique({ where: { id } })
  if (!friend || friend.addresseeId !== user.id) {
    return Response.json({ error: "Not authorized" }, { status: 403 })
  }

  if (action === "accept") {
    await prisma.friend.update({ where: { id }, data: { status: "ACCEPTED" } })
    const requester = await prisma.user.findUnique({
      where: { id: friend.requesterId },
      select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
    })
    if (requester) {
      await notifyUsers([requester], "Friend request accepted", `${getDisplayName(user)} accepted your friend request.`, {
        type: "friend_accept",
        friendId: user.id,
        url: buildAppUrl("friends"),
      })
    }
  } else if (action === "reject") {
    await prisma.friend.update({ where: { id }, data: { status: "REJECTED" } })
  }

  return Response.json({ success: true })
}

// DELETE /api/friends/[id] — remove a friendship
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const friend = await prisma.friend.findUnique({ where: { id } })
  if (!friend || (friend.requesterId !== user.id && friend.addresseeId !== user.id)) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.friend.update({
    where: { id },
    data: { status: "REMOVED" },
  })

  return Response.json({ success: true })
}
