import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { parseCSV } from "@/lib/csv-parser"
import { checkRateLimit } from "@/lib/rate-limit"
import { insertNewTransactions } from "@/lib/persist-transactions"
import {
  type AIRefineInput,
  batchRefineTransactionsWithAI,
  classifyTransaction,
  makeHash,
  shouldRefineWithAI,
} from "@/lib/categorize"

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

// POST /api/transactions/import
// Body: multipart/form-data with "file" field (CSV or XLSX)
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  // 10 CSV imports per hour per user
  if (!await checkRateLimit(`import-csv:${user.id}`, 10, 60 * 60 * 1000)) {
    return Response.json({ error: "Too many imports. Please wait before importing again." }, { status: 429 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file || typeof file === "string") return Response.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_IMPORT_BYTES) {
      return Response.json({ error: "File too large. Maximum size is 5 MB." }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { transactions, bank, skipped } = await parseCSV(buffer)

    if (transactions.length === 0) {
      return Response.json({ error: "No transactions found in file", skipped }, { status: 400 })
    }

    const toRefine: Array<AIRefineInput & {
      idx: number
    }> = []
    const rows: {
      id: string; userId: string; date: Date; amount: number; type: string;
      description: string; rawDescription: string; category: string;
      bank: string | null; source: string; hash: string; createdAt: Date;
    }[] = []

    for (const t of transactions) {
      const hash = makeHash(user.id, t.date.toISOString().split("T")[0], t.amount, t.rawDescription)
      const classified = classifyTransaction({
        rawDescription: t.rawDescription,
        type: t.type as "debit" | "credit",
      })

      if (shouldRefineWithAI(classified, t.rawDescription)) {
        toRefine.push({
          idx: rows.length,
          key: `${t.type}|${t.rawDescription}`,
          rawDescription: t.rawDescription,
          description: classified.description,
          type: t.type as "debit" | "credit",
          category: classified.category,
          intent: classified.intent,
        })
      }

      rows.push({
        id: crypto.randomUUID(),
        userId: user.id,
        date: t.date,
        amount: t.amount,
        type: t.type,
        description: classified.description,
        rawDescription: t.rawDescription,
        category: classified.category,
        bank,
        source: "csv",
        hash,
        createdAt: new Date(),
      })
    }

    if (toRefine.length > 0) {
      const aiMap = await batchRefineTransactionsWithAI(toRefine)
      for (const item of toRefine) {
        const refined = aiMap[item.key]
        if (!refined) continue
        rows[item.idx].description = refined.description || rows[item.idx].description
        rows[item.idx].category = refined.category
      }
    }

    const { imported, duplicates } = await insertNewTransactions(rows)

    return Response.json({ imported, duplicates, skipped, bank })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed"
    return Response.json({ error: msg }, { status: 400 })
  }
}
