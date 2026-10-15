import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { buildBalanceMap, getPairwiseNetCents, getNetPerPerson, simplifyDebts } from "@/lib/balance"
import { buildAppUrl, getDisplayName, notifyUsers } from "@/lib/notify"
import { logActivity } from "@/lib/activity"
import { checkRateLimit } from "@/lib/rate-limit"
import { CURRENCY_RE, readJson, type JsonBody } from "@/lib/request"

class SettleError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

// POST /api/groups/[id]/settle
// Body: { toUserId, fromUserId?, amount, currency?, note? }
// fromUserId defaults to the caller. Recording a payment between two other people is
// allowed for the receiver (confirming they got paid) and for group admins.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (!await checkRateLimit(`settle:${user.id}`, 20, 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }

  const { id: groupId } = await params

  try {
    const { toUserId, fromUserId: rawFrom, amount, note, currency: reqCurrency } = await readJson<JsonBody>(req)
    const fromUserId: string = rawFrom ?? user.id

    const numAmount = typeof amount === "number" ? amount : parseFloat(amount)
    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 1_000_000) {
      return Response.json({ error: "Settlement amount must be a positive number" }, { status: 400 })
    }
    if (typeof toUserId !== "string" || typeof fromUserId !== "string" || !toUserId || toUserId === fromUserId) {
      return Response.json({ error: "Invalid recipient" }, { status: 400 })
    }
    if (reqCurrency !== undefined && (typeof reqCurrency !== "string" || !CURRENCY_RE.test(reqCurrency))) {
      return Response.json({ error: "Invalid currency" }, { status: 400 })
    }
    if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 200)) {
      return Response.json({ error: "Note is too long" }, { status: 400 })
    }

    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: { id: true, name: true, email: true, pushDevices: { select: { token: true } } } } },
    })
    const me = groupMembers.find((m) => m.userId === user.id)
    if (!me) return Response.json({ error: "Not a member" }, { status: 403 })
    const payer = groupMembers.find((m) => m.userId === fromUserId)
    const recipient = groupMembers.find((m) => m.userId === toUserId)
    if (!payer || !recipient) {
      return Response.json({ error: "Both people must be members of this group" }, { status: 400 })
    }
    const actingForOthers = fromUserId !== user.id
    if (actingForOthers && toUserId !== user.id && me.role !== "ADMIN") {
      return Response.json({ error: "Only admins can record payments between other members" }, { status: 403 })
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { currency: true, name: true, emoji: true, smartDebtsEnabled: true },
    })
    const defaultCurrency = group?.currency ?? "USD"
    const settleCurrency: string = reqCurrency ?? defaultCurrency
    const requestedCents = Math.round(numAmount * 100)

    // Read-validate-write inside one transaction so two concurrent settle-ups
    // can't both pass the "how much is owed" check and double-pay.
    const settlement = await prisma.$transaction(async (tx) => {
      const [expenses, priorSettlements] = await Promise.all([
        tx.expense.findMany({ where: { groupId, currency: settleCurrency }, include: { splits: true } }),
        tx.settlement.findMany({ where: { groupId, currency: settleCurrency } }),
      ])

      let owedCents: number
      if (group?.smartDebtsEnabled) {
        const entry = simplifyDebts(getNetPerPerson(expenses, priorSettlements, true))
          .find((e) => e.fromUserId === fromUserId && e.toUserId === toUserId)
        owedCents = entry?.amountCents ?? 0
      } else {
        owedCents = getPairwiseNetCents(buildBalanceMap(expenses, priorSettlements, true), fromUserId, toUserId)
      }
      if (owedCents <= 0) {
        throw new SettleError(
          actingForOthers ? "There is no outstanding debt between these members in this currency"
                          : "You do not owe this person anything in this currency"
        )
      }

      return tx.settlement.create({
        data: {
          groupId,
          fromUserId,
          toUserId,
          amount: Math.min(requestedCents, owedCents), // stored in cents, never more than owed
          currency: settleCurrency,
          note: note?.trim() || null,
        },
        include: {
          fromUser: { select: { id: true, name: true, email: true, image: true } },
          toUser: { select: { id: true, name: true, email: true, image: true } },
        },
      })
    })

    await prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } })

    after(async () => {
      const title = `${group?.emoji ?? "✅"} Settlement in ${group?.name ?? "your group"}`
      const amountStr = `${settlement.amount / 100} ${settlement.currency}`
      const data = { type: "settlement", groupId, settlementId: settlement.id, url: buildAppUrl(`group/${groupId}`) }
      const payerName = getDisplayName(payer.user)
      const recipientName = getDisplayName(recipient.user)
      // The two people involved get a direct message (unless they recorded it themselves)
      if (toUserId !== user.id) {
        await notifyUsers([recipient.user], title,
          actingForOthers ? `${getDisplayName(user)} recorded ${payerName} paying you ${amountStr}` : `${payerName} settled ${amountStr} with you`, data)
      }
      if (fromUserId !== user.id) {
        await notifyUsers([payer.user], title, `${getDisplayName(user)} recorded your payment of ${amountStr} to ${recipientName}`, data)
      }
      await notifyUsers(
        groupMembers.map((m) => m.user),
        title,
        `${payerName} paid ${recipientName}`,
        data,
        [user.id, fromUserId, toUserId]
      )
      await logActivity({
        type: "settlement",
        actorId: fromUserId,
        groupId,
        targetUserId: toUserId,
        meta: {
          settlementId: settlement.id,
          amount: settlement.amount / 100,
          currency: settlement.currency,
          toUserName: recipientName,
          recordedBy: actingForOthers ? getDisplayName(user) : undefined,
          groupName: group?.name,
          groupEmoji: group?.emoji,
          note: settlement.note,
        },
      })
    })

    return Response.json({ ...settlement, amount: settlement.amount / 100 }, { status: 201 })
  } catch (err) {
    if (err instanceof SettleError) return Response.json({ error: err.message }, { status: err.status })
    console.error(err)
    return Response.json({ error: "Failed to record settlement" }, { status: 500 })
  }
}
