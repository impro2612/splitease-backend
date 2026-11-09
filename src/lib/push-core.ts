// Pure helpers for Expo push delivery: no network, no Prisma, so they can be unit-tested
// directly. push.ts and the push-receipts cron do the I/O around these.

export type PushMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
}

export type OkTicket = { id: string; token: string }

// token is null for request-level errors that Expo returns without a per-message ticket
export type PushError = { token: string | null; message?: string; error?: string }

export type ParsedTickets = {
  okTickets: OkTicket[]
  staleTokens: string[]
  errors: PushError[]
}

export type ParsedReceipts = {
  processedIds: string[] // tickets Expo returned a receipt for (ok or error)
  staleTokens: string[]
  errors: PushError[]
}

// Expo accepts at most 100 messages per send call and 1000 ids per getReceipts call
export const EXPO_SEND_CHUNK = 100
export const EXPO_RECEIPT_CHUNK = 300

export const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/

export function isExpoToken(token: unknown): token is string {
  return typeof token === "string" && EXPO_TOKEN_RE.test(token)
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new RangeError("chunk size must be >= 1")
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Logs must not leak full device tokens: keep the first 8 chars of the inner id only
export function maskToken(token: string): string {
  const m = /^(Expo(?:nent)?PushToken)\[([^\]]*)\]$/.exec(token)
  if (!m) return token.slice(0, 8) + "…"
  return `${m[1]}[${m[2].slice(0, 8)}…]`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

function errorCode(ticket: Record<string, unknown>): string | undefined {
  return isRecord(ticket.details) ? str(ticket.details.error) : undefined
}

/**
 * Map Expo's send response (`{ data: Ticket[], errors?: [...] }`) back onto the chunk
 * that was sent. Tickets align with messages by index.
 */
export function parseTickets(sent: PushMessage[], response: unknown): ParsedTickets {
  const out: ParsedTickets = { okTickets: [], staleTokens: [], errors: [] }
  const body = isRecord(response) ? response : {}

  // Request-level errors (e.g. PUSH_TOO_MANY_EXPERIENCE_IDS) arrive without tickets
  if (Array.isArray(body.errors)) {
    for (const e of body.errors) {
      const rec = isRecord(e) ? e : {}
      out.errors.push({ token: null, message: str(rec.message), error: str(rec.code) })
    }
  }

  if (!Array.isArray(body.data)) {
    if (!out.errors.length) out.errors.push({ token: null, message: "malformed ticket response" })
    return out
  }

  const stale = new Set<string>()
  body.data.forEach((ticket, i) => {
    const token = sent[i]?.to
    if (!token) return // more tickets than messages: nothing to map them to
    if (!isRecord(ticket)) {
      out.errors.push({ token, message: "malformed ticket" })
      return
    }
    if (ticket.status === "ok" && typeof ticket.id === "string") {
      out.okTickets.push({ id: ticket.id, token })
      return
    }
    const error = errorCode(ticket)
    if (error === "DeviceNotRegistered") stale.add(token)
    else out.errors.push({ token, message: str(ticket.message), error })
  })
  out.staleTokens = [...stale]
  return out
}

/**
 * Map Expo's getReceipts response (`{ data: { [ticketId]: Receipt } }`) back onto the
 * tickets we asked about. Ids missing from `data` have no receipt yet and are left alone.
 */
export function parseReceipts(tickets: OkTicket[], response: unknown): ParsedReceipts {
  const out: ParsedReceipts = { processedIds: [], staleTokens: [], errors: [] }
  const data = isRecord(response) && isRecord(response.data) ? response.data : null
  if (!data) {
    out.errors.push({ token: null, message: "malformed receipt response" })
    return out
  }

  const stale = new Set<string>()
  for (const t of tickets) {
    if (!Object.hasOwn(data, t.id)) continue
    out.processedIds.push(t.id)
    const receipt = data[t.id]
    if (!isRecord(receipt)) {
      out.errors.push({ token: t.token, message: "malformed receipt" })
      continue
    }
    if (receipt.status === "ok") continue
    const error = errorCode(receipt)
    if (error === "DeviceNotRegistered") stale.add(t.token)
    else out.errors.push({ token: t.token, message: str(receipt.message), error })
  }
  out.staleTokens = [...stale]
  return out
}
