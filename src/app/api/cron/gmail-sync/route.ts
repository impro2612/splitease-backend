import { NextRequest } from "next/server"
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

function extractBody(payload: Record<string, unknown>): string {
  if (payload.body && (payload.body as { size: number }).size > 0) {
    return base64Decode((payload.body as { data: string }).data ?? "")
  }
  const parts = (payload.parts as Record<string, unknown>[] | undefined) ?? []
  for (const part of parts) {
    if (part.mimeType === "text/plain") {
      return base64Decode(((part.body as { data?: string }) ?? {}).data ?? "")
    }
  }
  for (const part of parts) {
    const nested = extractBody(part as Record<string, unknown>)
    if (nested) return nested
  }
  return ""
}

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron (or allow manual trigger with secret)
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const connections = await prisma.gmailConnection.findMany()
  const results: Record<string, number> = {}

  for (const conn of connections) {
    try {
      const accessToken = await refreshAccessToken(conn.refreshToken)
      if (!accessToken) { results[conn.userId] = -1; continue }

      // Build search query — only since last sync
      const sinceDate = conn.lastSyncAt ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const afterEpoch = Math.floor(sinceDate.getTime() / 1000)
      const query = `(${BANK_QUERY}) after:${afterEpoch}`

      const listData = await gmailFetch(
        `users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`,
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
          const from    = headers.find((h: { name: string }) => h.name === "From")?.value ?? ""
          const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? ""
          const dateStr = headers.find((h: { name: string }) => h.name === "Date")?.value ?? ""
          const receivedDate = dateStr ? new Date(dateStr) : new Date()
          const body = extractBody(detail.payload ?? {})

          const parsed = parseTransactionEmail(from, subject, body, receivedDate)
          if (!parsed) continue

          const hash = makeHash(conn.userId, parsed.date.toISOString().split("T")[0], parsed.amount, parsed.rawDescription)

          // Skip if already imported
          const exists = await prisma.personalTransaction.findUnique({ where: { hash } })
          if (exists) continue

          const description = normalizeDescription(parsed.rawDescription)
          const category = categorizeByRules(parsed.rawDescription)

          const txn = {
            id: crypto.randomUUID(),
            userId: conn.userId,
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

          if (category === "Miscellaneous") {
            uncategorized.push({ idx: newTxns.length, desc: description })
          }
          newTxns.push(txn)
        } catch { /* skip bad message */ }
      }

      // AI categorize uncategorized ones in batch
      if (uncategorized.length > 0) {
        const aiMap = await batchCategorizeWithAI(uncategorized.map((u) => u.desc))
        for (const { idx, desc } of uncategorized) {
          if (aiMap[desc]) newTxns[idx].category = aiMap[desc]
        }
      }

      // Bulk insert
      if (newTxns.length > 0) {
        for (const t of newTxns) {
          try {
            await prisma.personalTransaction.create({ data: t })
          } catch { /* duplicate hash, skip */ }
        }
      }

      await prisma.gmailConnection.update({
        where: { id: conn.id },
        data: { lastSyncAt: new Date(), accessToken, updatedAt: new Date() },
      })

      results[conn.userId] = newTxns.length
    } catch (err) {
      console.error(`Gmail sync failed for user ${conn.userId}:`, err)
      results[conn.userId] = -1
    }
  }

  return Response.json({ ok: true, results })
}
