import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { chatMember } from "@/lib/group-chat"

type Params = { params: Promise<{ groupId: string }> }

// GET /api/group-chats/:groupId — chat header info, members and my settings
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  const { groupId } = await params
  const me = await chatMember(groupId, user.id)
  if (!me) return Response.json({ error: "Not a member of this group" }, { status: 403 })

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true, name: true, emoji: true, color: true,
      members: { select: { role: true, chatLeft: true, user: { select: { id: true, name: true, email: true, image: true } } } },
    },
  })
  if (!group) return Response.json({ error: "Group not found" }, { status: 404 })

  return Response.json({
    groupId: group.id,
    name: group.name,
    emoji: group.emoji,
    color: group.color,
    muted: me.chatMuted,
    left: me.chatLeft,
    members: group.members.map((m) => ({ ...m.user, role: m.role, left: m.chatLeft })),
  })
}

// PATCH /api/group-chats/:groupId — { muted?: boolean, left?: boolean } (mute, exit or rejoin)
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  const { groupId } = await params
  const me = await chatMember(groupId, user.id)
  if (!me) return Response.json({ error: "Not a member of this group" }, { status: 403 })

  const { muted, left } = await req.json().catch(() => ({}))
  const data: { chatMuted?: boolean; chatLeft?: boolean; chatReadAt?: Date } = {}
  if (typeof muted === "boolean") data.chatMuted = muted
  if (typeof left === "boolean") {
    data.chatLeft = left
    if (!left) data.chatReadAt = new Date() // rejoining starts with nothing unread
  }
  if (Object.keys(data).length === 0) return Response.json({ error: "Nothing to update" }, { status: 400 })

  const updated = await prisma.groupMember.update({
    where: { groupId_userId: { groupId, userId: user.id } },
    data,
    select: { chatMuted: true, chatLeft: true },
  })
  return Response.json({ muted: updated.chatMuted, left: updated.chatLeft })
}
