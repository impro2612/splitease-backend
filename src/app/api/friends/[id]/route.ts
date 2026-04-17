import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

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
  } else if (action === "reject") {
    await prisma.friend.delete({ where: { id } })
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

  await prisma.friend.delete({ where: { id } })

  return Response.json({ success: true })
}
