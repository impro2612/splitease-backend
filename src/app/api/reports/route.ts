import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { readJson } from "@/lib/request"

const REASONS = new Set(["spam", "harassment", "inappropriate", "scam", "other"])

// POST /api/reports — report a user or one of their chat messages.
// Stores the report (with a snapshot of the message, so deleting it afterwards hides
// nothing) for manual review. Blocking is a separate, immediate action in the app.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!await checkRateLimit(`reports:${user.id}`, 10, 60 * 60 * 1000)) {
    return Response.json({ error: "Too many reports. Please try again later." }, { status: 429 })
  }

  const { targetUserId, reason, details, messageId, groupMessageId, groupId } = await readJson<{
    targetUserId: unknown; reason: unknown; details?: unknown; messageId?: unknown; groupMessageId?: unknown; groupId?: unknown
  }>(req)
  if (typeof targetUserId !== "string" || !targetUserId || targetUserId === user.id) {
    return Response.json({ error: "Invalid user" }, { status: 400 })
  }
  if (typeof reason !== "string" || !REASONS.has(reason)) return Response.json({ error: "Pick a reason" }, { status: 400 })
  if (details !== undefined && (typeof details !== "string" || details.length > 500)) {
    return Response.json({ error: "Details must be at most 500 characters" }, { status: 400 })
  }
  const optId = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : undefined)
  const msgId = optId(messageId), gMsgId = optId(groupMessageId), grpId = optId(groupId)

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
  if (!target) return Response.json({ error: "User not found" }, { status: 404 })

  // Snapshot the message, and make sure it really is from the reported user and visible to the reporter
  let snapshot: string | null = null
  if (msgId) {
    const m = await prisma.message.findFirst({
      where: { id: msgId, senderId: targetUserId, receiverId: user.id },
      select: { content: true },
    })
    if (!m) return Response.json({ error: "Message not found" }, { status: 404 })
    snapshot = m.content
  } else if (gMsgId) {
    const m = await prisma.groupMessage.findFirst({
      where: { id: gMsgId, senderId: targetUserId, group: { members: { some: { userId: user.id } } } },
      select: { content: true, groupId: true },
    })
    if (!m) return Response.json({ error: "Message not found" }, { status: 404 })
    snapshot = m.content
  }

  await prisma.report.create({
    data: {
      reporterId: user.id,
      targetUserId,
      reason,
      details: typeof details === "string" && details.trim() ? details.trim() : null,
      messageId: msgId ?? null,
      groupMessageId: gMsgId ?? null,
      groupId: grpId ?? null,
      snapshot,
    },
  })
  return Response.json({ ok: true }, { status: 201 })
}
