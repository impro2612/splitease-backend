import { prisma } from "@/lib/prisma"

export type ActivityType =
  | "expense_added"
  | "expense_edited"
  | "expense_deleted"
  | "settlement"
  | "group_created"
  | "group_renamed"
  | "group_deleted"
  | "member_joined"
  | "friend_request_sent"
  | "friend_accepted"
  | "smart_debts_toggled"

export function logActivity(opts: {
  type: ActivityType
  actorId: string
  groupId?: string
  targetUserId?: string
  meta?: Record<string, unknown>
}) {
  return prisma.activity.create({
    data: {
      type: opts.type,
      actorId: opts.actorId,
      groupId: opts.groupId ?? null,
      targetUserId: opts.targetUserId ?? null,
      meta: JSON.stringify(opts.meta ?? {}),
    },
  }).catch(() => {}) // never let logging failures break the main flow
}
