import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await params

  // Verify membership
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  })
  if (!member) return Response.json({ error: "Not a member of this group" }, { status: 403 })

  try {
    const { description, amount, category, paidById, splitType, splits, date } = await req.json()

    if (!description || !amount || !paidById) {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      return Response.json({ error: "Invalid amount" }, { status: 400 })
    }

    // Get all group members for split calculation
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
    })

    let splitData: { userId: string; amount: number; paid: boolean }[]

    if (splitType === "EQUAL") {
      const perPerson = numAmount / groupMembers.length
      splitData = groupMembers.map((m) => ({
        userId: m.userId,
        amount: Math.round(perPerson * 100) / 100,
        paid: m.userId === paidById,
      }))
    } else if (splitType === "EXACT" && splits) {
      splitData = splits.map((s: { userId: string; amount: number }) => ({
        userId: s.userId,
        amount: s.amount,
        paid: s.userId === paidById,
      }))
    } else if (splitType === "PERCENTAGE" && splits) {
      splitData = splits.map((s: { userId: string; percentage: number }) => ({
        userId: s.userId,
        amount: Math.round((s.percentage / 100) * numAmount * 100) / 100,
        paid: s.userId === paidById,
      }))
    } else {
      return Response.json({ error: "Invalid split configuration" }, { status: 400 })
    }

    const expense = await prisma.expense.create({
      data: {
        groupId,
        description,
        amount: numAmount,
        category: category ?? "general",
        paidById,
        createdById: user.id,
        splitType,
        date: date ? new Date(date) : new Date(),
        splits: {
          create: splitData,
        },
      },
      include: {
        paidBy: { select: { id: true, name: true, email: true, image: true } },
        splits: {
          include: { user: { select: { id: true, name: true, email: true, image: true } } },
        },
      },
    })

    // Update group updatedAt
    await prisma.group.update({
      where: { id: groupId },
      data: { updatedAt: new Date() },
    })

    return Response.json(expense, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to create expense" }, { status: 500 })
  }
}
