import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import {
  type AIRefineInput,
  type Category,
  batchRefineTransactionsWithAI,
  classifyTransaction,
  makeHash,
  shouldRefineWithAI,
} from "@/lib/categorize"
import { generateSuggestionsForMonth } from "@/lib/financial-suggestions"
import { getResolvedPDFJS } from "unpdf"

export const maxDuration = 300

const MONTH_NAME_TO_NUMBER: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function monthFromName(name: string) {
  return MONTH_NAME_TO_NUMBER[name.toLowerCase()] ?? null
}

function buildMonthKey(year: string, month: string) {
  const yyyy = year.length === 2 ? `20${year}` : year
  return `${yyyy}-${month.padStart(2, "0")}`
}

function parseDateToken(token: string): string | null {
  const numeric = token.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/)
  if (numeric) {
    return buildMonthKey(numeric[3], numeric[2])
  }

  const dayMonthNameYear = token.match(/\b\d{1,2}\s+([A-Za-z]{3,9})[,]?\s+(\d{2,4})\b/i)
  if (dayMonthNameYear) {
    const month = monthFromName(dayMonthNameYear[1])
    if (month) return buildMonthKey(dayMonthNameYear[2], month)
  }

  const monthNameYear = token.match(/\b([A-Za-z]{3,9})\s+(\d{2,4})\b/i)
  if (monthNameYear) {
    const month = monthFromName(monthNameYear[1])
    if (month) return buildMonthKey(monthNameYear[2], month)
  }

  const monthYearNumeric = token.match(/\b(\d{1,2})[\/\-.](\d{4})\b/)
  if (monthYearNumeric) {
    return buildMonthKey(monthYearNumeric[2], monthYearNumeric[1])
  }

  const yearMonthNumeric = token.match(/\b(\d{4})[\/\-.](\d{1,2})\b/)
  if (yearMonthNumeric) {
    return buildMonthKey(yearMonthNumeric[1], yearMonthNumeric[2])
  }

  return null
}

function detectStatementMonth(firstPageText: string): string | null {
  const text = normalizeWhitespace(firstPageText)

  const rangePatterns = [
    /\bfrom\b\s*[:\-]?\s*([A-Za-z0-9\/\-. ,]+?)\s+\bto\b\s*[:\-]?\s*([A-Za-z0-9\/\-. ,]+?)(?=\b(?:statement|account|date|period|narration|withdrawal|deposit)\b|$)/i,
    /\bstatement\s+period\b\s*[:\-]?\s*([A-Za-z0-9\/\-. ,]+?)\s+(?:to|-)\s*([A-Za-z0-9\/\-. ,]+?)(?=\b(?:statement|account|date|narration|withdrawal|deposit)\b|$)/i,
    /\bperiod\b\s*[:\-]?\s*([A-Za-z0-9\/\-. ,]+?)\s+(?:to|-)\s*([A-Za-z0-9\/\-. ,]+?)(?=\b(?:statement|account|date|narration|withdrawal|deposit)\b|$)/i,
  ]

  for (const pattern of rangePatterns) {
    const match = text.match(pattern)
    if (!match) continue
    const startMonth = parseDateToken(match[1])
    const endMonth = parseDateToken(match[2])
    if (startMonth && endMonth && startMonth === endMonth) return startMonth
    if (startMonth) return startMonth
    if (endMonth) return endMonth
  }

  const directPatterns = [
    /\b(?:statement\s+of\s+account|statement|month)\b[^A-Za-z0-9]{0,10}([A-Za-z]{3,9}\s+\d{4})\b/i,
    /\b(?:statement\s+of\s+account|statement|month)\b[^A-Za-z0-9]{0,10}(\d{1,2}[\/\-.]\d{4})\b/i,
    /\b([A-Za-z]{3,9}\s+\d{4})\b/,
    /\b(\d{1,2}[\/\-.]\d{4})\b/,
    /\b(\d{4}[\/\-.]\d{1,2})\b/,
  ]

  for (const pattern of directPatterns) {
    const match = text.match(pattern)
    if (!match) continue
    const month = parseDateToken(match[1])
    if (month) return month
  }

  return null
}

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
  const expectedMonth = (formData.get("expectedMonth") as string | null)?.trim() ?? ""
  const arrayBuffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)
  // Capture base64 before passing to pdf.js — pdf.js transfers/detaches the ArrayBuffer
  // internally when it successfully opens the document, making uint8Array zero-length afterward.
  const pdfBase64 = Buffer.from(uint8Array).toString("base64")

  // Use unpdf only to detect password-protection — actual parsing is done by the Python service
  try {
    const pdfjs = await getResolvedPDFJS()
    const doc = await pdfjs.getDocument({
      data: uint8Array,
      ...(password ? { password } : {}),
    }).promise
    // Quick text check to rule out scanned/image PDFs
    const firstPage = await doc.getPage(1)
    const content = await firstPage.getTextContent()
    const firstPageText = normalizeWhitespace(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content.items.map((item: any) => item.str ?? "").join(" ")
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textLen = content.items.reduce((n: number, item: any) => n + (item.str?.length ?? 0), 0)
    if (textLen < 50) {
      return Response.json({
        error: "This looks like a scanned/image PDF. Please use a downloaded digital statement.",
      }, { status: 400 })
    }

    if (expectedMonth) {
      const detectedMonth = detectStatementMonth(firstPageText)
      if (!detectedMonth) {
        return Response.json({
          error: "Could not verify Month/Year from PDF. Please use a monthly bank statement with a visible statement period.",
        }, { status: 400 })
      }
      if (detectedMonth !== expectedMonth) {
        return Response.json({
          error: "Month/Year of PDF does not match the Import section.",
        }, { status: 400 })
      }
    }
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
    const name = err instanceof Error ? (err as { name?: string }).name ?? "" : ""
    const isPasswordIssue =
      msg.includes("password") || msg.includes("encrypt") ||
      name === "PasswordException" || name.toLowerCase().includes("password")
    if (isPasswordIssue) {
      if (password) return Response.json({ error: "Incorrect password. Please try again." }, { status: 400 })
      return Response.json({ needsPassword: true }, { status: 422 })
    }
    return Response.json({ error: "Could not read the PDF. Please try a different file." }, { status: 400 })
  }

  // Forward PDF to the Python pdfplumber service
  const parserUrl = process.env.PDF_PARSER_URL
  if (!parserUrl) {
    return Response.json({ error: "PDF parser service not configured." }, { status: 500 })
  }

  // Send as JSON+base64 — avoids Node.js FormData/multipart issues in serverless
  const jsonBody = JSON.stringify({
    pdf_base64: pdfBase64,
    ...(password ? { password } : {}),
  })

  // Poll /health until Render is alive (wakes cold-start instances),
  // then send the PDF once with no AbortSignal — maxDuration is the ceiling.
  async function callParser(): Promise<Response> {
    const WARM_LIMIT = 75_000
    const warmStart = Date.now()
    let healthy = false

    while (Date.now() - warmStart < WARM_LIMIT) {
      try {
        const h = await fetch(`${parserUrl}/health`, { signal: AbortSignal.timeout(5_000) })
        if (h.ok) { healthy = true; break }
      } catch { /* still waking */ }
      const elapsed = Date.now() - warmStart
      if (elapsed + 3_000 < WARM_LIMIT) await new Promise((r) => setTimeout(r, 3_000))
    }

    if (!healthy) throw new Error("Service did not become healthy within 75s")

    return fetch(`${parserUrl}/parse-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody,
    })
  }

  let rawTransactions: {
    date: string
    amount: number
    description: string
    type: "debit" | "credit"
    reference?: string
  }[]
  try {
    const pyRes = await callParser()

    if (pyRes.status === 422) {
      return Response.json({ needsPassword: true }, { status: 422 })
    }
    if (pyRes.status === 400) {
      const body = await pyRes.json().catch(() => ({}))
      return Response.json({ error: body.detail ?? "Incorrect password. Please try again." }, { status: 400 })
    }
    if (!pyRes.ok) {
      const body = await pyRes.json().catch(() => ({}))
      console.error("[import-pdf] Parser service error:", body)
      return Response.json({ error: "PDF parsing failed. Try a different statement." }, { status: 500 })
    }

    const body = await pyRes.json()
    rawTransactions = body.transactions ?? []
  } catch (err) {
    console.error("[import-pdf] Parser service unreachable:", err)
    return Response.json({ error: "PDF parser service is unavailable. Please try again shortly." }, { status: 503 })
  }

  if (!rawTransactions.length) {
    return Response.json({ imported: 0, total: 0 })
  }

  const toRefine: Array<AIRefineInput & {
    idx: number
  }> = []
  const txns: {
    id: string; userId: string; date: Date; amount: number; type: "debit" | "credit"
    description: string; rawDescription: string; category: string
    bank: string | null; source: "pdf"; hash: string; createdAt: Date
  }[] = []
  const occurrenceByKey = new Map<string, number>()

  for (const t of rawTransactions) {
    if (!t.date || !(t.amount > 0) || !t.description) continue
    const dateObj = new Date(t.date)
    if (isNaN(dateObj.getTime())) continue

    const classified = classifyTransaction({
      rawDescription: t.description,
      type: t.type,
    })
    const amount = Math.round(t.amount * 100)
    const reference = t.reference?.trim() || ""
    const occurrenceBaseKey = `${t.date}|${amount}|${t.type}|${t.description}|${reference}`
    const occurrence = occurrenceByKey.get(occurrenceBaseKey) ?? 0
    occurrenceByKey.set(occurrenceBaseKey, occurrence + 1)
    const hashKey = reference
      ? `${t.type}|${reference}|${t.description}`
      : `${t.type}|${t.description}|occurrence:${occurrence}`
    const hash = makeHash(user.id, t.date, amount, hashKey)
    const idx = txns.length

    txns.push({
      id: crypto.randomUUID(),
      userId: user.id,
      date: dateObj,
      amount,
      type: t.type,
      description: classified.description || t.description,
      rawDescription: t.description,
      category: classified.category as Category,
      bank: null,
      source: "pdf",
      hash,
      createdAt: new Date(),
    })

    if (shouldRefineWithAI(classified, t.description)) {
      toRefine.push({
        idx,
        key: `${t.type}|${t.description}`,
        rawDescription: t.description,
        description: classified.description || t.description,
        type: t.type,
        category: classified.category,
        intent: classified.intent,
      })
    }
  }

  if (toRefine.length > 0) {
    const aiMap = await batchRefineTransactionsWithAI(toRefine)
    for (const item of toRefine) {
      const refined = aiMap[item.key]
      if (!refined) continue
      txns[item.idx].description = refined.description || txns[item.idx].description
      txns[item.idx].category = refined.category
    }
  }

  let imported = 0
  for (const t of txns) {
    try {
      await prisma.personalTransaction.create({ data: t })
      imported++
    } catch { /* duplicate hash — skip */ }
  }

  if (expectedMonth) {
    const existingSuggestion = await prisma.personalSuggestion.findUnique({
      where: { userId: user.id },
      select: { analyzedMonth: true },
    })

    const shouldRefreshSuggestions =
      !existingSuggestion || expectedMonth >= existingSuggestion.analyzedMonth

    if (shouldRefreshSuggestions) {
      const generated = await generateSuggestionsForMonth(user.id, expectedMonth)
      if (generated) {
        await prisma.personalSuggestion.upsert({
          where: { userId: user.id },
          update: {
            analyzedMonth: generated.analyzedMonth,
            title: generated.title,
            summary: generated.summary,
            recommendations: JSON.stringify(generated.recommendations),
          },
          create: {
            userId: user.id,
            analyzedMonth: generated.analyzedMonth,
            title: generated.title,
            summary: generated.summary,
            recommendations: JSON.stringify(generated.recommendations),
          },
        })
      }
    }
  }

  return Response.json({ imported, total: rawTransactions.length })
}
