import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { parseCSV } from "@/lib/csv-parser"
import { categorizeByRules, normalizeDescription, makeHash, batchCategorizeWithAI } from "@/lib/categorize"

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

    const uncategorized: { idx: number; desc: string }[] = []
    const rows: {
      id: string; userId: string; date: Date; amount: number; type: string;
      description: string; rawDescription: string; category: string;
      bank: string | null; source: string; hash: string; createdAt: Date;
    }[] = []

    for (const t of transactions) {
      const hash = makeHash(user.id, t.date.toISOString().split("T")[0], t.amount, t.rawDescription)
      const description = normalizeDescription(t.rawDescription)
      const category = categorizeByRules(t.rawDescription)

      if (category === "Miscellaneous") {
        uncategorized.push({ idx: rows.length, desc: description })
      }

      rows.push({
        id: crypto.randomUUID(),
        userId: user.id,
        date: t.date,
        amount: t.amount,
        type: t.type,
        description,
        rawDescription: t.rawDescription,
        category,
        bank,
        source: "csv",
        hash,
        createdAt: new Date(),
      })
    }

    // AI categorize miscellaneous in batch
    if (uncategorized.length > 0) {
      const aiMap = await batchCategorizeWithAI(uncategorized.map((u) => u.desc))
      for (const { idx, desc } of uncategorized) {
        if (aiMap[desc]) rows[idx].category = aiMap[desc]
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
