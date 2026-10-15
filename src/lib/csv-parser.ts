import ExcelJS from "exceljs"

type ParsedTransaction = {
  amount: number
  type: "debit" | "credit"
  rawDescription: string
  date: Date
  bank: string
}

type BankFormat = {
  name: string
  dateCol: string
  descCol: string
  debitCol: string
  creditCol: string
  balanceCol?: string
  dateFormat?: string
}

const FORMATS: BankFormat[] = [
  { name: "HDFC",   dateCol: "date",             descCol: "narration",    debitCol: "debit amount",  creditCol: "credit amount" },
  { name: "ICICI",  dateCol: "transaction date",  descCol: "description",  debitCol: "debit",         creditCol: "credit" },
  { name: "SBI",    dateCol: "txn date",          descCol: "description",  debitCol: "debit",         creditCol: "credit" },
  { name: "Axis",   dateCol: "tran date",         descCol: "particulars",  debitCol: "dr",            creditCol: "cr" },
  { name: "Kotak",  dateCol: "dt",                descCol: "narration",    debitCol: "dr",            creditCol: "cr" },
  { name: "Yes",    dateCol: "date",              descCol: "transaction details", debitCol: "withdrawal amount", creditCol: "deposit amount" },
  { name: "PNB",    dateCol: "value date",        descCol: "particulars",  debitCol: "debit",         creditCol: "credit" },
  { name: "BOI",    dateCol: "txn date",          descCol: "description",  debitCol: "withdrawal",    creditCol: "deposit" },
]

function normalize(s: string) {
  return s?.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim() ?? ""
}

function detectFormat(headers: string[]): BankFormat | null {
  const h = headers.map(normalize)
  for (const fmt of FORMATS) {
    if (h.some((x) => x.includes(normalize(fmt.dateCol))) &&
        h.some((x) => x.includes(normalize(fmt.descCol))) &&
        h.some((x) => x.includes(normalize(fmt.debitCol)))) {
      return fmt
    }
  }
  return null
}

function findCol(headers: string[], target: string): number {
  const t = normalize(target)
  return headers.findIndex((h) => normalize(h).includes(t))
}

/** Amount cell → positive cents. Handles "1,234.50", "1,234.50 Dr", "(1,234.50)" and "-1,234.50". */
function parseAmt(val: string | number | Date | undefined): number {
  if (val === undefined || val === null || val === "" || val === "-") return 0
  if (val instanceof Date) return 0
  const n = typeof val === "number"
    ? val
    : parseFloat(String(val).replace(/[,\s]/g, "").replace(/^\((.*)\)$/, "$1").replace(/[^\d.\-]/g, ""))
  // Debit/credit are already separate columns, so the sign carries no extra meaning
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0
}

function parseDate(val: string | number | Date): Date | null {
  if (!val && val !== 0) return null
  // ExcelJS returns date cells as JS Date objects directly
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val
  const s = String(val).trim()
  // DD/MM/YYYY or DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m1) {
    const year = m1[3].length === 2 ? 2000 + parseInt(m1[3]) : parseInt(m1[3])
    return new Date(year, parseInt(m1[2]) - 1, parseInt(m1[1]))
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function cellToRaw(v: ExcelJS.CellValue): string | number | Date {
  if (v === null || v === undefined) return ""
  if (v instanceof Date) return v
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return typeof v === "boolean" ? (v ? "1" : "0") : v
  }
  if (typeof v === "object") {
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("")
    if ("result" in v) {
      const r = (v as ExcelJS.CellFormulaValue).result
      if (r instanceof Date || typeof r === "string" || typeof r === "number") return r
      return ""
    }
    if ("hyperlink" in v) return (v as ExcelJS.CellHyperlinkValue).text ?? ""
  }
  return ""
}

/** RFC-4180 style parser: quoted fields, "" escapes and newlines inside quotes. */
function parseCSVText(buffer: Buffer): (string | number | Date)[][] {
  const text = buffer.toString("utf-8").replace(/^\uFEFF/, "") // strip BOM
  const firstLine = text.slice(0, text.search(/\r?\n/) >>> 0)
  const delimiter = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ","
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQ = false
  const endRow = () => {
    row.push(field.trim())
    if (row.some((c) => c !== "")) rows.push(row)
    row = []
    field = ""
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQ = false
      else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === delimiter) { row.push(field.trim()); field = "" }
    else if (ch === "\n") endRow()
    else if (ch !== "\r") field += ch
  }
  if (field !== "" || row.length) endRow()
  return rows
}

export async function parseCSV(buffer: Buffer): Promise<{
  transactions: ParsedTransaction[]
  bank: string
  skipped: number
}> {
  // Detect XLSX by PK magic bytes (ZIP container)
  const isXLSX = buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4B

  let rows: (string | number | Date)[][] = []

  if (isXLSX) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const ws = workbook.worksheets[0]
    if (!ws) throw new Error("No worksheet found in XLSX file")
    ws.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed; slice(1) to get column-ordered array
      rows.push((row.values as ExcelJS.CellValue[]).slice(1).map(cellToRaw))
    })
  } else {
    rows = parseCSVText(buffer)
  }

  // Find the header row (first row with enough non-empty cells)
  let headerIdx = 0
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    if (rows[i].filter(Boolean).length >= 4) { headerIdx = i; break }
  }

  const headers = rows[headerIdx].map((c) => String(c ?? ""))
  const fmt = detectFormat(headers)
  const bankName = fmt?.name ?? "Unknown"

  const dateIdx   = fmt ? findCol(headers, fmt.dateCol)   : -1
  const descIdx   = fmt ? findCol(headers, fmt.descCol)   : -1
  const debitIdx  = fmt ? findCol(headers, fmt.debitCol)  : -1
  const creditIdx = fmt ? findCol(headers, fmt.creditCol) : -1

  if (dateIdx < 0 || descIdx < 0) {
    throw new Error(`Unrecognized bank statement format. Detected headers: ${headers.slice(0, 6).join(", ")}`)
  }

  const transactions: ParsedTransaction[] = []
  let skipped = 0

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((c) => !c)) continue

    const date = parseDate(row[dateIdx] as string | number | Date)
    if (!date) { skipped++; continue }

    const rawDescription = String(row[descIdx] ?? "").trim()
    if (!rawDescription) { skipped++; continue }

    const debit  = parseAmt(row[debitIdx])
    const credit = parseAmt(row[creditIdx])
    if (debit === 0 && credit === 0) { skipped++; continue }

    const type: "debit" | "credit" = debit > 0 ? "debit" : "credit"
    const amount = debit > 0 ? debit : credit

    transactions.push({ amount, type, rawDescription, date, bank: bankName })
  }

  return { transactions, bank: bankName, skipped }
}
