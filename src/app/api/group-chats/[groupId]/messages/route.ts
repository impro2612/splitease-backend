import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { checkRateLimit } from "@/lib/rate-limit"
import { chatMember, signalGroup } from "@/lib/group-chat"

type Params = { params: Promise<{ groupId: string }> }

// GET /api/group-chats/:groupId/messages?after=<ISO>&before=<clientId>&limit=<n>
// Newest first. Reading marks the chat as read for the caller.
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id) // chat is part of SplitIT Plus
  if (locked) return locked

  const { groupId } = await params
  const me = await chatMember(groupId, user.id)
  if (!me) return Response.json({ error: "Not a member of this group" }, { status: 403 })

  const url = new URL(req.url)
  const afterParam = url.searchParams.get("after")
  const before = url.searchParams.get("before")
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50") || 50, 1), 100)

  let createdAt: { gt?: Date; lt?: Date } | undefined
  if (afterParam && !isNaN(new Date(afterParam).getTime())) createdAt = { gt: new Date(afterParam) }
  if (before) {
    const cursor = await prisma.groupMessage.findFirst({ where: { groupId, clientId: before }, select: { createdAt: true } })
    createdAt = { lt: cursor?.createdAt ?? new Date() }
  }

  const messages = await prisma.groupMessage.findMany({
    where: { groupId, deleted: false, ...(createdAt ? { createdAt } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, senderId: true, content: true, clientId: true, createdAt: true,
      sender: { select: { name: true, email: true } },
      reactions: { select: { id: true, userId: true, emoji: true } },
    },
  })

  if (!me.chatLeft && !before) {
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: user.id } },
      data: { chatReadAt: new Date() },
    })
  }

  return Response.json({
    messages: messages.map(({ sender, ...m }) => ({ ...m, senderName: sender.name ?? sender.email })),
    hasMore: messages.length === limit,
  })
}

// POST /api/group-chats/:groupId/messages — { content, clientId }
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  if (!await checkRateLimit(`messages:${user.id}`, 60, 60 * 1000)) {
    return Response.json({ error: "Too many messages. Please slow down." }, { status: 429 })
  }

  const { groupId } = await params
  const me = await chatMember(groupId, user.id)
  if (!me) return Response.json({ error: "Not a member of this group" }, { status: 403 })
  if (me.chatLeft) return Response.json({ error: "You left this chat. Rejoin to send messages." }, { status: 403 })

  const { content, clientId } = await req.json().catch(() => ({}))
  if (typeof content !== "string" || !content || typeof clientId !== "string" || !clientId || clientId.length > 100) {
    return Response.json({ error: "Missing fields" }, { status: 400 })
  }
  if (content.length > 10_000) return Response.json({ error: "Message too long" }, { status: 400 })

  const message = await prisma.groupMessage.upsert({
    where: { senderId_clientId: { senderId: user.id, clientId } },
    update: {},
    create: { groupId, senderId: user.id, content, clientId },
  })
  // Sending counts as reading everything before it
  await prisma.groupMember.update({
    where: { groupId_userId: { groupId, userId: user.id } },
    data: { chatReadAt: message.createdAt },
  })

  await signalGroup(groupId, "group-message", { senderId: user.id, clientId: message.clientId })

  after(async () => {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        name: true,
        members: {
          where: { chatMuted: false, chatLeft: false, userId: { not: user.id } },
          select: { user: { select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } } } },
        },
      },
    })
    if (!group) return
    await notifyUsers(group.members.map((m) => m.user), group.name, `${getDisplayName(user)}: New message`, {
      type: "group_chat_message",
      groupId,
      url: buildAppUrl(`group-chat/${groupId}`),
    })
  })

  return Response.json({ ...message, senderName: user.name ?? user.email }, { status: 201 })
}

// DELETE /api/group-chats/:groupId/messages — { ids } deletes your own messages for everyone
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  const { groupId } = await params
  const { ids } = await req.json().catch(() => ({ ids: null }))
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((i) => typeof i === "string")) {
    return Response.json({ error: "ids required" }, { status: 400 })
  }

  const { count } = await prisma.groupMessage.updateMany({
    where: { id: { in: ids }, groupId, senderId: user.id },
    data: { deleted: true },
  })
  if (count > 0) await signalGroup(groupId, "group-message-deleted", { ids })
  return Response.json({ ok: true, deleted: count })
}
