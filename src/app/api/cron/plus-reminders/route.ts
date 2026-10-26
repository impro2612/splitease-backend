import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { trialEnd } from "@/lib/plus"
import { buildAppUrl, notifyUsers } from "@/lib/notify"

const DAY = 24 * 60 * 60 * 1000
// Reminder stages, largest first: a stage is sent once, when days left drops to it
const STAGES = [15, 7, 1]

const MESSAGES: Record<number, { title: string; body: string }> = {
  15: { title: "15 days of free Plus left", body: "Your free SplitIT Plus ends in 15 days. Splitting stays free forever — keep everything else for ₹49/month." },
  7:  { title: "1 week of free Plus left", body: "Your free SplitIT Plus ends in 7 days. Subscribe to keep My Spending, Trip Planner, ScrapBook and more." },
  1:  { title: "Free Plus ends tomorrow", body: "Your free SplitIT Plus ends tomorrow. Subscribe now so your extra features don't get locked." },
}

// Cancelled subscriptions (auto-renew off) get the same 15 / 7 / 1-day countdown.
// Renewing ones get nothing: their Plus doesn't end.
const ENDING: Record<number, { title: string; body: string }> = {
  15: { title: "Your Plus ends in 15 days", body: "Auto-renew is off, so your SplitIT Plus ends in 15 days. Renew any time to keep every feature." },
  7:  { title: "Your Plus ends in 1 week", body: "Your SplitIT Plus ends in 7 days. Renew to keep My Spending, Trip Planner, ScrapBook and more." },
  1:  { title: "Your Plus ends tomorrow", body: "Your SplitIT Plus ends tomorrow. Renew now so your extra features don't get locked. Splitting stays free." },
}

/** The countdown stage due for an end date, or undefined if none is due yet. */
function dueStage(end: Date, now: Date): number | undefined {
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / DAY)
  return STAGES.filter((s) => daysLeft <= s).pop() // smallest stage reached
}

// GET /api/cron/plus-reminders — daily Vercel cron. Sends the 15 / 7 / 1-day trial
// reminders (tracked in User.plusReminder) and subscription-ending reminders
// (User.plusEndReminder), each stage at most once per user.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  const now = new Date()
  const users = await prisma.user.findMany({
    where: {
      email: { not: { endsWith: "@deleted.invalid" } },
      OR: [{ plusUntil: null }, { plusUntil: { lt: now } }],
    },
    select: {
      id: true, name: true, email: true, createdAt: true, trialEndsAt: true, plusUntil: true, plusReminder: true,
      pushDevices: { select: { token: true } },
    },
  })

  let sent = 0
  for (const u of users) {
    const end = trialEnd(u)
    if (!end || end <= now) continue
    const stage = dueStage(end, now)
    if (stage === undefined) continue
    if (u.plusReminder !== null && u.plusReminder <= stage) continue // already sent this (or a later) stage
    await prisma.user.update({ where: { id: u.id }, data: { plusReminder: stage } })
    if (u.pushDevices.length) {
      const m = MESSAGES[stage]
      await notifyUsers([u], m.title, m.body, { type: "plus_trial", url: buildAppUrl("plus") }).catch(() => {})
      sent++
    }
  }

  const ending = await prisma.user.findMany({
    where: { email: { not: { endsWith: "@deleted.invalid" } }, plusWillRenew: false, plusUntil: { gt: now } },
    select: { id: true, name: true, email: true, plusUntil: true, plusEndReminder: true, pushDevices: { select: { token: true } } },
  })
  let endingSent = 0
  for (const u of ending) {
    const stage = dueStage(u.plusUntil!, now)
    if (stage === undefined) continue
    if (u.plusEndReminder !== null && u.plusEndReminder <= stage) continue
    await prisma.user.update({ where: { id: u.id }, data: { plusEndReminder: stage } })
    if (u.pushDevices.length) {
      const m = ENDING[stage]
      await notifyUsers([u], m.title, m.body, { type: "plus_ending", url: buildAppUrl("plus") }).catch(() => {})
      endingSent++
    }
  }
  return Response.json({ checked: users.length, sent, ending: ending.length, endingSent })
}
