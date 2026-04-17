import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSessionUser } from "@/lib/mobile-auth"

function expenseToApi(e: any) {
  return {
    ...e,
    amount: e.amount / 100,
    splits: e.splits?.map((s: any) => ({ ...s, amount: s.amount / 100 })),
  }
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: user.id } } },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
      expenses: {
        include: {
          paidBy: { select: { id: true, name: true, email: true, image: true } },
          splits: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { expenses: true } },
    },
    orderBy: { updatedAt: "desc" },
  })

  return Response.json(groups.map((g) => ({ ...g, expenses: g.expenses.map(expenseToApi) })))
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { name, description, color, emoji, currency } = await req.json()

    if (!name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 })

    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        description: description?.trim(),
        color: color ?? "#6366f1",
        emoji: emoji ?? "💰",
        currency: currency ?? "USD",
        createdById: user.id,
        members: { create: { userId: user.id, role: "ADMIN" } },
      },
      include: { members: { include: { user: true } } },
    })

    return Response.json(group, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to create group" }, { status: 500 })
  }
}
