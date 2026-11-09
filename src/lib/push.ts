import { prisma } from "@/lib/prisma"
import {
  chunk,
  EXPO_SEND_CHUNK,
  isExpoToken,
  maskToken,
  parseTickets,
  type PushMessage,
} from "./push-core"

export type { PushMessage } from "./push-core"

// Expo Push Notification helper — no SDK needed, just HTTP
const SEND_URL = "https://exp.host/--/api/v2/push/send"

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "accept-encoding": "gzip, deflate",
}

function toExpoMessage(m: PushMessage) {
  return {
    to: m.to,
    sound: "default",
    title: m.title,
    body: m.body,
    data: m.data ?? {},
    priority: "high",     // FCM high priority — wakes device immediately
    channelId: "default", // Android notification channel
    ttl: 604800,          // 7-day TTL so queued notifications still deliver
  }
}

/**
 * Send many pushes in as few HTTP calls as possible (100 per call, Expo's limit).
 * Never throws: delivery problems are logged, not surfaced to the caller, so a push
 * hiccup can't fail the request that triggered it.
 */
export async function sendPushMessages(messages: PushMessage[]): Promise<void> {
  const valid = messages.filter((m) => isExpoToken(m.to))
  if (!valid.length) return
  // Sequential: keeps us well under Expo's rate limit and makes failures attributable
  for (const group of chunk(valid, EXPO_SEND_CHUNK)) {
    await sendChunk(group).catch((err) => {
      console.error("[push] chunk failed", { count: group.length, error: errMsg(err) })
    })
  }
}

async function sendChunk(group: PushMessage[]): Promise<void> {
  let json: unknown
  try {
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(group.map(toExpoMessage)),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[push] send failed", { status: res.status, count: group.length, body: text.slice(0, 500) })
      return
    }
    json = await res.json()
  } catch (err) {
    console.error("[push] send request failed", { count: group.length, error: errMsg(err) })
    return
  }

  const { okTickets, staleTokens, errors } = parseTickets(group, json)
  for (const e of errors) {
    console.error("[push] ticket error", {
      token: e.token === null ? null : maskToken(e.token),
      message: e.message,
      error: e.error,
    })
  }
  // DeviceNotRegistered means the token is gone for good — drop it so we stop sending
  if (staleTokens.length) {
    await prisma.pushDevice
      .deleteMany({ where: { token: { in: staleTokens } } })
      .catch((err) => console.error("[push] stale token cleanup failed", { error: errMsg(err) }))
  }
  // Remember tickets so the push-receipts cron can check final delivery status later
  if (okTickets.length) {
    await prisma.pushTicket
      .createMany({ data: okTickets })
      .catch((err) => console.error("[push] ticket store failed", { count: okTickets.length, error: errMsg(err) }))
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

/** Single-token convenience wrapper; prefer sendPushMessages for fan-out. */
export async function sendPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (!pushToken) return
  await sendPushMessages([{ to: pushToken, title, body, data }])
}
