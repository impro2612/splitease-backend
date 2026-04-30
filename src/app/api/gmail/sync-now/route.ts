import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { parseTransactionEmail } from "@/lib/email-parser"
import { categorizeByRules, normalizeDescription, makeHash, batchCategorizeWithAI } from "@/lib/categorize"

const BANK_QUERY = [
  "from:alerts@hdfcbank.net",
  "from:autoreply@icicibank.com",
  "from:sbialert@sbi.co.in",
  "from:axis.alerts@axisbank.com",
  "from:alerts@kotak.com",
  "from:noreply@phonepe.com",
  "from:noreply-pay@google.com",
  "from:noreply@paytm.com",
].join(" OR ")

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  })
  const data = await res.json()
  return data.access_token ?? null
}

async function gmailFetch(path: string, accessToken: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`)
  return res.json()
}

function base64Decode(str: string): string {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function extractBody(payload: Record<string, unknown>): string {
  if (payload.body && (payload.body as { size: number }).size > 0) {
    return base64Decode((payload.body as { data: string }).data ?? "")
  }
  const parts = (payload.parts as Record<string, unknown>[] | undefined) ?? []
  for (const part of parts) {
    if (part.mimeType === "text/plain") return base64Decode(((part.body as { data?: string }) ?? {}).data ?? "")
  }
  for (const part of parts) {
    if (part.mimeType === "text/html") return stripHtml(base64Decode(((part.body as { data?: string }) ?? {}).data ?? ""))
  }
  for (const part of parts) {
    const nested = extractBody(part as Record<string, unknown>)
    if (nested) return nested
  }
  return ""
}

// POST /api/gmail/sync-now — manual trigger for the current user
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const conn = await prisma.gmailConnection.findUnique({ where: { userId: user.id } })
  if (!conn) return Response.json({ error: "Gmail not connected" }, { status: 400 })

  const accessToken = await refreshAccessToken(conn.refreshToken)
  if (!accessToken) return Response.json({ error: "Failed to refresh Gmail token" }, { status: 400 })

  // Sync last 90 days on first sync, otherwise since last sync
  const sinceDate = conn.lastSyncAt ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const afterEpoch = Math.floor(sinceDate.getTime() / 1000)
  const query = `(${BANK_QUERY}) after:${afterEpoch}`

  const listData = await gmailFetch(
    `users/me/messages?q=${encodeURIComponent(query)}&maxResults=200`,
    accessToken
  )
  const messages: { id: string }[] = listData.messages ?? []

  const newTxns: {
    id: string; userId: string; date: Date; amount: number; type: string;
    description: string; rawDescription: string; category: string;
    bank: string | null; source: string; hash: string; createdAt: Date;
  }[] = []
  const uncategorized: { idx: number; desc: string }[] = []

  for (const msg of messages) {
    try {
      const detail = await gmailFetch(`users/me/messages/${msg.id}?format=full`, accessToken)
      const headers: { name: string; value: string }[] = detail.payload?.headers ?? []
      const from = headers.find((h: { name: string }) => h.name === "From")?.value ?? ""
      const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? ""
      const dateStr = headers.find((h: { name: string }) => h.name === "Date")?.value ?? ""
      const receivedDate = dateStr ? new Date(dateStr) : new Date()
      const body = extractBody(detail.payload ?? {})

      const parsed = parseTransactionEmail(from, subject, body, receivedDate)
      if (!parsed) continue

      const hash = makeHash(user.id, parsed.date.toISOString().split("T")[0], parsed.amount, parsed.rawDescription)
      const exists = await prisma.personalTransaction.findUnique({ where: { hash } })
      if (exists) continue

      const description = normalizeDescription(parsed.rawDescription)
      const category = categorizeByRules(parsed.rawDescription)

      const txn = {
        id: crypto.randomUUID(),
        userId: user.id,
        date: parsed.date,
        amount: parsed.amount,
        type: parsed.type,
        description,
        rawDescription: parsed.rawDescription,
        category,
        bank: parsed.bank,
        source: "gmail",
        hash,
        createdAt: new Date(),
      }

      if (category === "Miscellaneous") uncategorized.push({ idx: newTxns.length, desc: description })
      newTxns.push(txn)
    } catch { /* skip bad message */ }
  }

  if (uncategorized.length > 0) {
    const aiMap = await batchCategorizeWithAI(uncategorized.map((u) => u.desc))
    for (const { idx, desc } of uncategorized) {
      if (aiMap[desc]) newTxns[idx].category = aiMap[desc]
    }
  }

  let imported = 0
  for (const t of newTxns) {
    try {
      await prisma.personalTransaction.create({ data: t })
      imported++
    } catch { /* duplicate */ }
  }

  await prisma.gmailConnection.update({
    where: { id: conn.id },
    data: { lastSyncAt: new Date(), accessToken, updatedAt: new Date() },
  })

  return Response.json({ imported, scanned: messages.length })
}
