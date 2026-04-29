import * as XLSX from "xlsx"
import type { ParsedTransaction } from "./email-parser"

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

function parseAmt(val: string | number | undefined): number {
  if (!val || val === "" || val === "-" || val === "0.00") return 0
  const n = parseFloat(String(val).replace(/,/g, "").trim())
  return isNaN(n) ? 0 : Math.round(n * 100)
}

function parseDate(val: string | number): Date | null {
  if (!val) return null
  // Excel serial number
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val)
    if (d) return new Date(d.y, d.m - 1, d.d)
  }
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

export function parseCSV(buffer: Buffer): {
  transactions: ParsedTransaction[]
  bank: string
  skipped: number
} {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as string[][]

  // Find the header row (first row with enough non-empty cells)
  let headerIdx = 0
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    if (rows[i].filter(Boolean).length >= 4) { headerIdx = i; break }
  }

  const headers = rows[headerIdx].map(String)
  const fmt = detectFormat(headers)
  const bankName = fmt?.name ?? "Unknown"

  const dateIdx  = fmt ? findCol(headers, fmt.dateCol)  : -1
  const descIdx  = fmt ? findCol(headers, fmt.descCol)  : -1
  const debitIdx = fmt ? findCol(headers, fmt.debitCol) : -1
  const creditIdx = fmt ? findCol(headers, fmt.creditCol) : -1

  if (dateIdx < 0 || descIdx < 0) {
    throw new Error(`Unrecognized bank statement format. Detected headers: ${headers.slice(0, 6).join(", ")}`)
  }

  const transactions: ParsedTransaction[] = []
  let skipped = 0

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((c) => !c)) continue

    const date = parseDate(row[dateIdx])
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
