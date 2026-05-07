import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { pusherServer } from "@/lib/pusher"

const ALLOWED_EMOJIS = new Set(["😮", "😂", "👍", "❤️", "🔥", "😢"])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId, expenseId } = await params
  const { emoji } = await req.json()

  if (!emoji || !ALLOWED_EMOJIS.has(emoji)) {
    return Response.json({ error: "Invalid emoji" }, { status: 400 })
  }

  // Verify user is a group member
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!member) return Response.json({ error: "Not a member" }, { status: 403 })

  // Verify expense belongs to this group
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId },
  })
  if (!expense) return Response.json({ error: "Expense not found" }, { status: 404 })

  // Toggle: if reaction exists delete it, otherwise create it
  const existing = await prisma.expenseReaction.findFirst({
    where: { expenseId, userId: user.id, emoji },
  })

  let action: "added" | "removed"
  if (existing) {
    await prisma.expenseReaction.delete({ where: { id: existing.id } })
    action = "removed"
  } else {
    await prisma.expenseReaction.create({
      data: { expenseId, userId: user.id, emoji },
    })
    action = "added"
  }

  // Notify all group members in real time
  const allMembers = await prisma.groupMember.findMany({ where: { groupId } })
  await Promise.all(
    allMembers.map((m) =>
      pusherServer
        .trigger(`private-user-${m.userId}`, "expense-reaction", {
          groupId, expenseId, emoji, userId: user.id, action,
        })
        .catch(() => {})
    )
  )

  return Response.json({ action, expenseId, emoji })
}
