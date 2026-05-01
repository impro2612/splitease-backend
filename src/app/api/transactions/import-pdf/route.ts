import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { categorizeByRules, normalizeDescription, makeHash, batchCategorizeWithAI } from "@/lib/categorize"
import { GoogleGenerativeAI } from "@google/generative-ai"
import * as pdfParseModule from "pdf-parse"
// pdf-parse ships CJS; handle both default and named export shapes
const pdfParse: (buf: Buffer, opts?: { password?: string }) => Promise<{ text: string }> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfParseModule as any).default ?? pdfParseModule

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return Response.json({ error: "No file provided" }, { status: 400 })
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return Response.json({ error: "Please upload a PDF bank statement" }, { status: 400 })
  }

  const password = (formData.get("password") as string | null) ?? undefined
  const buffer = Buffer.from(await file.arrayBuffer())

  let pdfText = ""
  try {
    const result = await pdfParse(buffer, password ? { password } : undefined)
    pdfText = result.text ?? ""
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
    const isPasswordIssue = msg.includes("password") || msg.includes("encrypt")
    if (isPasswordIssue) {
      if (password) {
        // Had a password but still failed — wrong password
        return Response.json({ error: "Incorrect password. Please try again." }, { status: 400 })
      }
      // No password supplied — ask for one
      return Response.json({ needsPassword: true }, { status: 422 })
    }
    return Response.json({ error: "Could not read the PDF. Please try a different file." }, { status: 400 })
  }

  if (pdfText.trim().length < 100) {
    return Response.json({
      error: "This looks like a scanned/image PDF. Please use a downloaded digital statement (not a photo or scan).",
    }, { status: 400 })
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "AI parsing not configured" }, { status: 500 })
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
  })

  // Send at most 30k chars — covers ~30 pages of statements
  const textChunk = pdfText.slice(0, 30000)

  const prompt = `You are a bank statement parser. Extract all DEBIT transactions from the following Indian bank statement text.

Return ONLY a JSON array — no explanation, no markdown, just the array:
[{"date":"YYYY-MM-DD","amount":1234.56,"description":"merchant or payee name"}]

Rules:
- Include ONLY debits (money going OUT): withdrawals, purchases, UPI payments, NEFT/IMPS sent, EMI, charges
- SKIP credits/deposits (money coming IN)
- amount = rupees as a decimal number (e.g. 557.60 not 55760)
- date = YYYY-MM-DD format
- description = merchant name, payee UPI ID, or transaction narration (max 80 chars, trim whitespace)
- If no debit transactions found, return []

Bank statement:
${textChunk}`

  let rawTransactions: { date: string; amount: number; description: string }[] = []
  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const match = text.match(/\[[\s\S]*\]/)
    if (match) rawTransactions = JSON.parse(match[0])
  } catch {
    return Response.json({ error: "Could not parse transactions from this PDF. Try a different statement format." }, { status: 500 })
  }

  if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
    return Response.json({ imported: 0, total: 0 })
  }

  const uncategorized: { idx: number; desc: string }[] = []

  const txns = rawTransactions
    .filter((t) => t.date && t.amount > 0 && t.description)
    .map((t, idx) => {
      const description = normalizeDescription(t.description)
      const category = categorizeByRules(t.description)
      const dateObj = new Date(t.date)
      const date = isNaN(dateObj.getTime()) ? new Date() : dateObj
      const amount = Math.round(t.amount * 100)
      const hash = makeHash(user.id, t.date, amount, t.description)
      if (category === "Miscellaneous") uncategorized.push({ idx, desc: description })
      return {
        id: crypto.randomUUID(),
        userId: user.id,
        date,
        amount,
        type: "debit" as const,
        description,
        rawDescription: t.description,
        category,
        bank: null as string | null,
        source: "pdf",
        hash,
        createdAt: new Date(),
      }
    })

  if (uncategorized.length > 0) {
    const aiMap = await batchCategorizeWithAI(uncategorized.map((u) => u.desc))
    for (const { idx, desc } of uncategorized) {
      if (aiMap[desc]) txns[idx].category = aiMap[desc]
    }
  }

  let imported = 0
  for (const t of txns) {
    try {
      await prisma.personalTransaction.create({ data: t })
      imported++
    } catch { /* duplicate hash, skip */ }
  }

  return Response.json({ imported, total: rawTransactions.length })
}
