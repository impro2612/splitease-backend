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
  if (memberships.length === 0) return Response.json({ chats: [] })

  // Three fixed queries instead of two per group: the latest message time per group,
  // the rows at those times (for sender + content), and the unread count per group.
  const ids = memberships.map((m) => m.group.id)
  const latest = await prisma.groupMessage.groupBy({
    by: ["groupId"],
    where: { groupId: { in: ids }, deleted: false },
    _max: { createdAt: true },
  })
  const latestPairs = latest.flatMap((l) => l._max.createdAt ? [{ groupId: l.groupId, createdAt: l._max.createdAt }] : [])
  const unreadFilters = memberships
    .filter((m) => !m.chatLeft)
    .map((m) => ({ groupId: m.group.id, deleted: false, senderId: { not: user.id }, createdAt: { gt: m.chatReadAt ?? m.joinedAt } }))
  const [lastRows, unreadRows] = await Promise.all([
    latestPairs.length
      ? prisma.groupMessage.findMany({
          where: { OR: latestPairs },
          select: { groupId: true, content: true, createdAt: true, senderId: true, sender: { select: { name: true, email: true } } },
        })
      : [],
    unreadFilters.length
      ? prisma.groupMessage.groupBy({ by: ["groupId"], where: { OR: unreadFilters }, _count: { _all: true } })
      : [],
  ])
  // Two messages can share a createdAt; keep one per group (any of them is "the latest")
  const lastByGroup = new Map<string, (typeof lastRows)[number]>()
  for (const row of lastRows) if (!lastByGroup.has(row.groupId)) lastByGroup.set(row.groupId, row)
  const unreadByGroup = new Map(unreadRows.map((r) => [r.groupId, r._count._all]))

  const chats = memberships.map((m) => {
    const last = lastByGroup.get(m.group.id)
    return {
      groupId: m.group.id,
      name: m.group.name,
      emoji: m.group.emoji,
      imageUrl: m.group.imageUrl,
      color: m.group.color,
      memberCount: m.group._count.members,
      muted: m.chatMuted,
      left: m.chatLeft,
      unread: m.chatLeft ? 0 : (unreadByGroup.get(m.group.id) ?? 0),
      lastMessage: last
        ? { content: last.content, createdAt: last.createdAt, senderId: last.senderId, senderName: last.sender.name ?? last.sender.email }
        : null,
      activityAt: (last?.createdAt ?? m.group.createdAt).toISOString(),
    }
  })
  chats.sort((a, b) => b.activityAt.localeCompare(a.activityAt))
  return Response.json({ chats })
}
