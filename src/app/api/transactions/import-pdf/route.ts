import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { categorizeByRules, normalizeDescription, makeHash, batchCategorizeWithAI } from "@/lib/categorize"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getResolvedPDFJS } from "unpdf"

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
  const arrayBuffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  let pdfText = ""
  try {
    const pdfjs = await getResolvedPDFJS()
    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
      ...(password ? { password } : {}),
    })
    const doc = await loadingTask.promise
    const pageTexts: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pageTexts.push(content.items.map((item: any) => item.str ?? "").join(" "))
    }
    pdfText = pageTexts.join("\n")
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
    const name = err instanceof Error ? (err as { name?: string }).name ?? "" : ""
    const isPasswordIssue =
      msg.includes("password") || msg.includes("encrypt") ||
      name === "PasswordException" || name.toLowerCase().includes("password")
    if (isPasswordIssue) {
      if (password) {
        return Response.json({ error: "Incorrect password. Please try again." }, { status: 400 })
      }
      return Response.json({ needsPassword: true }, { status: 422 })
    }
    return Response.json({ error: "Could not read the PDF. Please try a different file." }, { status: 400 })
  }

  if (pdfText.trim().length < 100) {
    return Response.json({
      error: "This looks like a scanned/image PDF. Please use a downloaded digital statement (not a photo or scan).",
    }, { status: 400 })
  }

  console.log(`[import-pdf] PDF text length: ${pdfText.trim().length} chars`)

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "AI parsing not configured" }, { status: 500 })
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json" },
  })

  // Send at most 20k chars to stay well within timeout budget
  const textChunk = pdfText.slice(0, 20000)

  const prompt = `You are a bank statement parser. Extract all DEBIT transactions from the following Indian bank statement text.

Return ONLY a JSON array (no markdown, no explanation):
[{"date":"YYYY-MM-DD","amount":1234.56,"description":"merchant or payee name"}]

Rules:
- Include ONLY debits (money going OUT): withdrawals, purchases, UPI payments, NEFT/IMPS sent, EMI, charges
- SKIP credits/deposits (money coming IN)
- amount = rupees as a positive decimal number (e.g. 557.60)
- date = YYYY-MM-DD format
- description = merchant name, payee UPI ID, or transaction narration (max 80 chars, trimmed)
- If no debit transactions found, return []

Bank statement text:
${textChunk}`

  let rawTransactions: { date: string; amount: number; description: string }[] = []
  try {
    const result = await model.generateContent(prompt)
    const responseText = result.response.text().trim()
    console.log(`[import-pdf] Gemini response length: ${responseText.length}, preview: ${responseText.slice(0, 300)}`)
    // responseMimeType:"application/json" makes Gemini return valid JSON directly
    // but also handle code fences and nested object shapes as fallbacks
    let parsed: unknown
    try {
      parsed = JSON.parse(responseText)
    } catch {
      const stripped = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim()
      const match = stripped.match(/\[[\s\S]*\]/)
      if (match) parsed = JSON.parse(match[0])
    }
    if (Array.isArray(parsed)) {
      rawTransactions = parsed
    } else if (parsed && typeof parsed === "object") {
      // Gemini sometimes wraps array in {"transactions":[...]}
      const wrap = parsed as Record<string, unknown>
      const arr = wrap.transactions ?? wrap.debits ?? wrap.data ?? wrap.results
      if (Array.isArray(arr)) rawTransactions = arr as typeof rawTransactions
    }
  } catch (geminiErr) {
    const errMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr)
    console.error("[import-pdf] Gemini error:", errMsg)
    const isQuota = errMsg.includes("quota") || errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("rate limit")
    const isAuth = errMsg.includes("401") || errMsg.includes("403") || errMsg.includes("API_KEY") || errMsg.includes("authentication")
    if (isQuota) return Response.json({ error: "AI quota limit reached. Please try again in a minute." }, { status: 503 })
    if (isAuth) return Response.json({ error: "AI service key is invalid or expired." }, { status: 500 })
    return Response.json({ error: `AI parsing failed: ${errMsg.slice(0, 120)}` }, { status: 500 })
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
