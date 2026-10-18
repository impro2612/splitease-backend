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

// GET /api/cron/plus-reminders — daily Vercel cron. Sends the 15 / 7 / 1-day
// trial reminders, each at most once per user (tracked in User.plusReminder).
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
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / DAY)
    const stage = STAGES.filter((s) => daysLeft <= s).pop() // smallest stage reached
    if (stage === undefined) continue
    if (u.plusReminder !== null && u.plusReminder <= stage) continue // already sent this (or a later) stage
    await prisma.user.update({ where: { id: u.id }, data: { plusReminder: stage } })
    if (u.pushDevices.length) {
      const m = MESSAGES[stage]
      await notifyUsers([u], m.title, m.body, { type: "plus_trial", url: buildAppUrl("plus") }).catch(() => {})
      sent++
    }
  }
  return Response.json({ checked: users.length, sent })
}
