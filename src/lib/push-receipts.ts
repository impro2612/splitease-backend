import { prisma } from "@/lib/prisma"
import { chunk, EXPO_RECEIPT_CHUNK, maskToken, parseReceipts } from "@/lib/push-core"

const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
const MINUTE = 60 * 1000
// Expo needs a few minutes to produce receipts, and discards them after about a day
const RECEIPT_DELAY = 15 * MINUTE
const RECEIPT_TTL = 24 * 60 * MINUTE
const BATCH = 1000

export type PushReceiptsResult = {
  checked: number; processed: number; pending: number; staleDevicesRemoved: number; errors: number; failedChunks: number; expired: number
}

/**
 * Asks Expo for the delivery receipts of tickets stored by sendPushMessages, drops
 * PushDevice rows whose receipt says DeviceNotRegistered, and deletes ticket rows once
 * they have been checked or expired. Runs from the daily cleanup cron (Vercel Hobby
 * allows two cron jobs) and from /api/cron/push-receipts for a manual trigger.
 */
export async function processPushReceipts(): Promise<PushReceiptsResult> {
  const now = Date.now()

  // Receipts older than a day can no longer be fetched: nothing to learn from those rows
  const expired = await prisma.pushTicket.deleteMany({ where: { createdAt: { lt: new Date(now - RECEIPT_TTL) } } })

  const tickets = await prisma.pushTicket.findMany({
    where: { createdAt: { lt: new Date(now - RECEIPT_DELAY) } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  })

  let stale = 0, errors = 0, failedChunks = 0
  const processed: string[] = []
  for (const group of chunk(tickets, EXPO_RECEIPT_CHUNK)) {
    let json: unknown
    try {
      const res = await fetch(RECEIPTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "accept-encoding": "gzip, deflate" },
        body: JSON.stringify({ ids: group.map((t) => t.id) }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        console.error("[push] receipt fetch failed", { status: res.status, count: group.length, body: text.slice(0, 500) })
        failedChunks++
        continue // rows stay, next run retries
      }
      json = await res.json()
    } catch (err) {
      console.error("[push] receipt request failed", { count: group.length, error: err instanceof Error ? err.message : String(err) })
      failedChunks++
      continue
    }

    const r = parseReceipts(group, json)
    for (const e of r.errors) {
      console.error("[push] receipt error", { token: e.token === null ? null : maskToken(e.token), message: e.message, error: e.error })
    }
    errors += r.errors.length
    if (r.staleTokens.length) {
      const del = await prisma.pushDevice.deleteMany({ where: { token: { in: r.staleTokens } } })
      stale += del.count
    }
    processed.push(...r.processedIds)
  }

  if (processed.length) await prisma.pushTicket.deleteMany({ where: { id: { in: processed } } })

  return {
    checked: tickets.length,
    processed: processed.length,
    pending: tickets.length - processed.length, // no receipt yet; retried next run
    staleDevicesRemoved: stale,
    errors,
    failedChunks,
    expired: expired.count,
  }
}
