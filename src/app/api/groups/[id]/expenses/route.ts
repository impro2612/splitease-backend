import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

/** Convert a DB expense (amounts in cents) to the API shape (amounts in dollars). */
function expenseToApi(e: any) {
  return {
    ...e,
    amount: e.amount / 100,
    splits: e.splits?.map((s: any) => ({ ...s, amount: s.amount / 100 })),
  }
}

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

    // Fetch group + members together
    const [groupData, groupMembers] = await Promise.all([
      prisma.group.findUnique({ where: { id: groupId }, select: { currency: true } }),
      prisma.groupMember.findMany({ where: { groupId }, include: { user: true } }),
    ])

    const memberIdSet = new Set(groupMembers.map((m) => m.userId))

    // 0-decimal currencies have no sub-units (JPY, KRW, VND, IDR, HUF, CLP, COP)
    const NO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "IDR", "HUF", "CLP", "COP"])
    const isNoDecimal = NO_DECIMAL_CURRENCIES.has(groupData?.currency ?? "USD")

    let splitData: { userId: string; amount: number; paid: boolean }[]

    const totalCents = Math.round(numAmount * 100) // canonical: always store 100× base unit

    if (splitType === "EQUAL") {
      const n = groupMembers.length
      if (isNoDecimal) {
        // Split at base-unit level (e.g. whole yen), then convert to cents for storage
        const totalUnits = Math.round(numAmount)
        const baseUnits = Math.floor(totalUnits / n)
        const extra = totalUnits - baseUnits * n
        splitData = groupMembers.map((m, i) => ({
          userId: m.userId,
          amount: (baseUnits + (i < extra ? 1 : 0)) * 100, // stored as cents
          paid: m.userId === paidById,
        }))
      } else {
        const baseCents = Math.floor(totalCents / n)
        const extra = totalCents - baseCents * n
        splitData = groupMembers.map((m, i) => ({
          userId: m.userId,
          amount: baseCents + (i < extra ? 1 : 0),
          paid: m.userId === paidById,
        }))
      }
    } else if (splitType === "EXACT" && splits) {
      for (const s of splits) {
        if (!memberIdSet.has(s.userId)) {
          return Response.json({ error: `User ${s.userId} is not a member of this group` }, { status: 400 })
        }
      }
      const splitSum = (splits as { userId: string; amount: number }[]).reduce((acc, s) => acc + s.amount, 0)
      if (Math.abs(splitSum - numAmount) > 0.01) {
        return Response.json(
          { error: `Split amounts sum to ${splitSum.toFixed(2)} but expense is ${numAmount.toFixed(2)}` },
          { status: 400 }
        )
      }
      splitData = splits.map((s: { userId: string; amount: number }) => ({
        userId: s.userId,
        amount: Math.round(s.amount * 100), // client sends dollars, store as cents
        paid: s.userId === paidById,
      }))
    } else if (splitType === "PERCENTAGE" && splits) {
      for (const s of splits) {
        if (!memberIdSet.has(s.userId)) {
          return Response.json({ error: `User ${s.userId} is not a member of this group` }, { status: 400 })
        }
      }
      const pctSum = (splits as { userId: string; percentage: number }[]).reduce((acc, s) => acc + s.percentage, 0)
      if (Math.abs(pctSum - 100) > 0.01) {
        return Response.json(
          { error: `Percentages sum to ${pctSum.toFixed(2)}% instead of 100%` },
          { status: 400 }
        )
      }
      const rawCents = (splits as { userId: string; percentage: number }[]).map((s) =>
        Math.floor((s.percentage / 100) * totalCents)
      )
      const rawSum = rawCents.reduce((a, b) => a + b, 0)
      let remainder = totalCents - rawSum
      splitData = (splits as { userId: string; percentage: number }[]).map((s, i) => {
        const extra = remainder > 0 ? 1 : 0
        if (remainder > 0) remainder--
        return { userId: s.userId, amount: rawCents[i] + extra, paid: s.userId === paidById }
      })
    } else {
      return Response.json({ error: "Invalid split configuration" }, { status: 400 })
    }

    const expense = await prisma.expense.create({
      data: {
        groupId,
        description,
        amount: totalCents, // stored as cents
        currency: groupData?.currency ?? "USD",
        category: category ?? "general",
        paidById,
        createdById: user.id,
        splitType,
        date: date ? new Date(date) : new Date(),
        splits: { create: splitData },
      },
      include: {
        paidBy: { select: { id: true, name: true, email: true, image: true } },
        splits: {
          include: { user: { select: { id: true, name: true, email: true, image: true } } },
        },
      },
    })

    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })

    // Return dollars to client
    return Response.json(expenseToApi(expense), { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to create expense" }, { status: 500 })
  }
}
