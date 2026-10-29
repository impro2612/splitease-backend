import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"

// GET /api/group-chats — the chat of every group the user is in, newest activity first
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id) // chat is part of SplitIT Plus
  if (locked) return locked

  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    select: {
      chatMuted: true, chatLeft: true, chatReadAt: true, joinedAt: true,
      group: { select: { id: true, name: true, emoji: true, imageUrl: true, color: true, createdAt: true, _count: { select: { members: true } } } },
    },
  })

  const chats = await Promise.all(memberships.map(async (m) => {
    const since = m.chatReadAt ?? m.joinedAt
    const [last, unread] = await Promise.all([
      prisma.groupMessage.findFirst({
        where: { groupId: m.group.id, deleted: false },
        orderBy: { createdAt: "desc" },
        select: { content: true, createdAt: true, senderId: true, sender: { select: { name: true, email: true } } },
      }),
      m.chatLeft ? 0 : prisma.groupMessage.count({
        where: { groupId: m.group.id, deleted: false, senderId: { not: user.id }, createdAt: { gt: since } },
      }),
    ])
    return {
      groupId: m.group.id,
      name: m.group.name,
      emoji: m.group.emoji,
      imageUrl: m.group.imageUrl,
      color: m.group.color,
      memberCount: m.group._count.members,
      muted: m.chatMuted,
      left: m.chatLeft,
      unread,
      lastMessage: last
        ? { content: last.content, createdAt: last.createdAt, senderId: last.senderId, senderName: last.sender.name ?? last.sender.email }
        : null,
      activityAt: (last?.createdAt ?? m.group.createdAt).toISOString(),
    }
  }))
  chats.sort((a, b) => b.activityAt.localeCompare(a.activityAt))
  return Response.json({ chats })
}
