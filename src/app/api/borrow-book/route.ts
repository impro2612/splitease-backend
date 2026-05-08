import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

function toApi(e: any) {
  return { ...e, amount: e.amount / 100 }
}

// GET /api/borrow-book — all entries + per-friend summaries
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const entries = await prisma.borrowEntry.findMany({
    where: {
      OR: [{ lenderId: user.id }, { borrowerId: user.id }],
    },
    include: {
      lender:   { select: { id: true, name: true, email: true, image: true } },
      borrower: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  // Build per-friend summary
  const friendMap = new Map<string, { friend: any; net: number; pendingCount: number }>()
  for (const e of entries) {
    const friendUser = e.lenderId === user.id ? e.borrower : e.lender
    const isMine = e.lenderId === user.id  // positive = they owe me
    const delta = isMine ? e.amount : -e.amount
    const existing = friendMap.get(friendUser.id)
    if (existing) {
      if (e.status === "PENDING") {
        existing.net += delta
        existing.pendingCount++
      }
    } else {
      friendMap.set(friendUser.id, {
        friend: friendUser,
        net: e.status === "PENDING" ? delta : 0,
        pendingCount: e.status === "PENDING" ? 1 : 0,
      })
    }
  }

  return Response.json({
    entries: entries.map(toApi),
    friends: Array.from(friendMap.values()).map((f) => ({ ...f, net: f.net / 100 })),
  })
}

// POST /api/borrow-book — create entry
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { friendId, amount, note, iAmLender, currency } = await req.json()
  if (!friendId || !amount || amount <= 0) {
    return Response.json({ error: "friendId and positive amount required" }, { status: 400 })
  }

  // Verify friendship
  const friendship = await prisma.friend.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: user.id, addresseeId: friendId },
        { requesterId: friendId, addresseeId: user.id },
      ],
    },
  })
  if (!friendship) return Response.json({ error: "Not friends" }, { status: 403 })

  const entry = await prisma.borrowEntry.create({
    data: {
      lenderId:   iAmLender ? user.id : friendId,
      borrowerId: iAmLender ? friendId : user.id,
      amount: Math.round(amount * 100),
      currency: currency ?? "INR",
      note: note ?? null,
    },
    include: {
      lender:   { select: { id: true, name: true, email: true, image: true } },
      borrower: { select: { id: true, name: true, email: true, image: true } },
    },
  })

  return Response.json(toApi(entry), { status: 201 })
}
