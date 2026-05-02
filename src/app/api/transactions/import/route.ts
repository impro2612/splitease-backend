import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { parseCSV } from "@/lib/csv-parser"
import {
  type AIRefineInput,
  batchRefineTransactionsWithAI,
  classifyTransaction,
  makeHash,
  shouldRefineWithAI,
} from "@/lib/categorize"

// POST /api/transactions/import
// Body: multipart/form-data with "file" field (CSV or XLSX)
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return Response.json({ error: "No file provided" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const { transactions, bank, skipped } = parseCSV(buffer)

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

    let imported = 0
    let duplicates = 0

    for (const row of rows) {
      try {
        await prisma.personalTransaction.create({ data: row })
        imported++
      } catch {
        duplicates++ // unique hash constraint = already exists
      }
    }

    return Response.json({ imported, duplicates, skipped, bank })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Import failed"
    return Response.json({ error: msg }, { status: 400 })
  }
}
