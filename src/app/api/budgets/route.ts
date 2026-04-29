import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { CATEGORIES } from "@/lib/categorize"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const budgets = await prisma.personalBudget.findMany({ where: { userId: user.id } })
  return Response.json(budgets.map((b) => ({ ...b, amount: b.amount / 100 })))
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { category, amount } = await req.json()

  if (!CATEGORIES.includes(category)) {
    return Response.json({ error: "Invalid category" }, { status: 400 })
  }
  const numAmount = parseFloat(amount)
  if (isNaN(numAmount) || numAmount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 })
  }

  const budget = await prisma.personalBudget.upsert({
    where: { userId_category: { userId: user.id, category } },
    create: { userId: user.id, category, amount: Math.round(numAmount * 100) },
    update: { amount: Math.round(numAmount * 100), updatedAt: new Date() },
  })

  return Response.json({ ...budget, amount: budget.amount / 100 })
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { category } = await req.json()
  await prisma.personalBudget.deleteMany({ where: { userId: user.id, category } })
  return Response.json({ success: true })
}
