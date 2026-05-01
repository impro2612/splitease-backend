import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { categorizeByRules, normalizeDescription, makeHash, batchCategorizeWithAI } from "@/lib/categorize"
import { getResolvedPDFJS } from "unpdf"

export const maxDuration = 300

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textLen = content.items.reduce((n: number, item: any) => n + (item.str?.length ?? 0), 0)
    if (textLen < 50) {
      return Response.json({
        error: "This looks like a scanned/image PDF. Please use a downloaded digital statement.",
      }, { status: 400 })
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

  let rawTransactions: { date: string; amount: number; description: string; type: "debit" | "credit" }[]
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

  const uncategorized: { idx: number; desc: string }[] = []
  const txns: {
    id: string; userId: string; date: Date; amount: number; type: "debit" | "credit"
    description: string; rawDescription: string; category: string
    bank: string | null; source: "pdf"; hash: string; createdAt: Date
  }[] = []

  for (const t of rawTransactions) {
    if (!t.date || !(t.amount > 0) || !t.description) continue
    const dateObj = new Date(t.date)
    if (isNaN(dateObj.getTime())) continue

    const description = normalizeDescription(t.description)
    const category = categorizeByRules(description || t.description)
    const amount = Math.round(t.amount * 100)
    const hash = makeHash(user.id, t.date, amount, `${t.type}|${t.description}`)
    const idx = txns.length

    txns.push({
      id: crypto.randomUUID(),
      userId: user.id,
      date: dateObj,
      amount,
      type: t.type,
      description: description || t.description,
      rawDescription: t.description,
      category,
      bank: null,
      source: "pdf",
      hash,
      createdAt: new Date(),
    })

    if (category === "Miscellaneous") uncategorized.push({ idx, desc: description || t.description })
  }

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
    } catch { /* duplicate hash — skip */ }
  }

  return Response.json({ imported, total: rawTransactions.length })
}
