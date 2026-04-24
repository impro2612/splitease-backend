import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { pusherServer } from "@/lib/pusher"

// GET /api/blocks — list users blocked by the current user
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const blocks = await prisma.block.findMany({
    where: { blockerId: user.id },
    include: { blocked: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "desc" },
  })

  return Response.json({ blocks })
}

// POST /api/blocks — block a user
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { blockedId } = await req.json()
  if (!blockedId || blockedId === user.id) {
    return Response.json({ error: "Invalid user" }, { status: 400 })
  }

  // Remove any existing friendship / pending requests between the two
  await prisma.friend.updateMany({
    where: {
      status: { in: ["ACCEPTED", "PENDING"] },
      OR: [
        { requesterId: user.id, addresseeId: blockedId },
        { requesterId: blockedId, addresseeId: user.id },
      ],
    },
    data: { status: "REMOVED" },
  })

  // Upsert the block record
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: user.id, blockedId } },
    update: {},
    create: { id: crypto.randomUUID(), blockerId: user.id, blockedId },
  })

  // Notify the blocked user so their friends list refreshes in real-time
  await pusherServer.trigger(`private-user-${blockedId}`, "friend-update", { action: "removed" }).catch(() => {})

  return Response.json({ ok: true })
}
