import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { pusherServer } from "@/lib/pusher"
import { checkRateLimit } from "@/lib/rate-limit"
import { CURRENCY_RE, parseOptionalDate } from "@/lib/request"

type EntryWithPayments = Prisma.BorrowEntryGetPayload<{
  include: {
    lender: { select: { id: true; name: true; email: true; image: true } }
    borrower: { select: { id: true; name: true; email: true; image: true } }
    payments: true
  }
}>

type FriendUser = EntryWithPayments["lender"]

function toApi(e: EntryWithPayments) {
  const paidAmount = e.payments.reduce((s, p) => s + p.amount, 0)
  return {
    ...e,
    amount: e.amount / 100,                       // original full amount
    paidAmount: paidAmount / 100,                  // total paid back so far
    remainingAmount: (e.amount - paidAmount) / 100, // still outstanding
    payments: e.payments.map((p) => ({ ...p, amount: p.amount / 100 })),
  }
}

// GET /api/borrow-book — all entries + per-friend summaries (uses remaining balance)
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const entries = await prisma.borrowEntry.findMany({
    where: { OR: [{ lenderId: user.id }, { borrowerId: user.id }] },
    include: {
      lender:   { select: { id: true, name: true, email: true, image: true } },
      borrower: { select: { id: true, name: true, email: true, image: true } },
      payments: { orderBy: { date: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  })

  // Per-friend summary using remaining (not original) amounts, kept per currency —
  // ₹ and $ IOUs must never be netted against each other.
  const friendMap = new Map<string, { friend: FriendUser; nets: Record<string, number>; pendingCount: number }>()
  for (const e of entries) {
    const friendUser = e.lenderId === user.id ? e.borrower : e.lender
    const entry = friendMap.get(friendUser.id) ?? { friend: friendUser, nets: {}, pendingCount: 0 }
    friendMap.set(friendUser.id, entry)
    if (e.status !== "PENDING") continue
    const remaining = e.amount - e.payments.reduce((s, p) => s + p.amount, 0)
    const delta = e.lenderId === user.id ? remaining : -remaining
    entry.nets[e.currency] = (entry.nets[e.currency] ?? 0) + delta
    entry.pendingCount++
  }

  return Response.json({
    entries: entries.map(toApi),
    friends: Array.from(friendMap.values()).map((f) => {
      const nets = Object.fromEntries(
        Object.entries(f.nets).filter(([, v]) => v !== 0).map(([c, v]) => [c, v / 100])
      )
      const currencies = Object.keys(nets)
      // `net`/`currency` kept for older app builds: only meaningful with a single currency
      return { ...f, nets, net: currencies.length === 1 ? nets[currencies[0]] : 0, currency: currencies[0] ?? null }
    }),
  })
}

// POST /api/borrow-book — create entry
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (!await checkRateLimit(`borrow-book:${user.id}`, 30, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }

  const { friendId, amount, note, iAmLender, currency, date } = await req.json().catch(() => ({}))
  if (typeof friendId !== "string" || !friendId || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return Response.json({ error: "friendId and positive finite amount required" }, { status: 400 })
  }
  if (currency !== undefined && (typeof currency !== "string" || !CURRENCY_RE.test(currency))) {
    return Response.json({ error: "Invalid currency" }, { status: 400 })
  }
  if (note != null && (typeof note !== "string" || note.length > 200)) {
    return Response.json({ error: "Note is too long" }, { status: 400 })
  }
  const entryDate = parseOptionalDate(date)
  if (entryDate === undefined) return Response.json({ error: "Invalid date" }, { status: 400 })

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
      lenderId:   iAmLender === true ? user.id : friendId,
      borrowerId: iAmLender === true ? friendId : user.id,
      amount: Math.round(amount * 100),
      currency: currency ?? "INR",
      note: note?.trim() || null,
      date: entryDate ?? new Date(),
    },
    include: {
      lender:   { select: { id: true, name: true, email: true, image: true } },
      borrower: { select: { id: true, name: true, email: true, image: true } },
      payments: true,
    },
  })

  // Push real-time update to both parties
  const otherUserId = iAmLender === true ? entry.borrowerId : entry.lenderId
  after(() => pusherServer.trigger(
    [`private-user-${user.id}`, `private-user-${otherUserId}`],
    "iou-updated",
    {},
  ).catch(() => {}))

  // Notify the other person
  const otherUser = await prisma.user.findUnique({
    where: { id: otherUserId },
    select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } },
  })
  if (otherUser) {
    const myName = getDisplayName(user)
    const amtStr = `${entry.amount / 100} ${entry.currency}`
    const [title, body] = iAmLender
      ? ["📖 New IOU", `${myName} lent you ${amtStr}`]
      : ["📖 New IOU", `${myName} says they borrowed ${amtStr} from you`]
    after(() => notifyUsers([otherUser], title, body, {
      type: "iou_created",
      url: buildAppUrl("borrow-book"),
    }).catch(() => {}))
  }

  return Response.json(toApi(entry), { status: 201 })
}
