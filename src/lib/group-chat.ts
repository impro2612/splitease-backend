import { prisma } from "@/lib/prisma"
import { pusherServer } from "@/lib/pusher"

// Every group has one chat. Who is in it is simply who is in the group: creating the
// group puts the creator in, adding/removing a member adds/removes them, and deleting
// the group deletes its messages. GroupMember only carries per-member chat settings.

export function chatMember(groupId: string, userId: string) {
  return prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { userId: true, chatMuted: true, chatLeft: true, chatReadAt: true, joinedAt: true },
  })
}

/** Send a realtime signal to every member of the group (Pusher allows 100 channels per call). */
export async function signalGroup(groupId: string, event: string, data: Record<string, unknown>) {
  const members = await prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } })
  const channels = members.map((m) => `private-user-${m.userId}`)
  for (let i = 0; i < channels.length; i += 100) {
    await pusherServer.trigger(channels.slice(i, i + 100), event, { groupId, ...data }).catch(() => {})
  }
}
