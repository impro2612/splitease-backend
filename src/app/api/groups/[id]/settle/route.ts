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

  try {
    const { toUserId, amount, note } = await req.json()

    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    })
    if (!member) return Response.json({ error: "Not a member" }, { status: 403 })

    const settlement = await prisma.settlement.create({
      data: {
        groupId,
        fromUserId: user.id,
        toUserId,
        amount: parseFloat(amount),
        note,
      },
      include: {
        fromUser: { select: { id: true, name: true, email: true, image: true } },
        toUser: { select: { id: true, name: true, email: true, image: true } },
      },
    })

    return Response.json(settlement, { status: 201 })
  } catch (err) {
    console.error(err)
    return Response.json({ error: "Failed to record settlement" }, { status: 500 })
  }
}
