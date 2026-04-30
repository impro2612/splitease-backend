// Parses bank transaction alert emails into structured transaction data

export interface ParsedTransaction {
  amount: number       // in paise
  type: "debit" | "credit"
  rawDescription: string
  date: Date
  bank: string
}

interface BankPattern {
  name: string
  senders: string[]
  debitRegex: RegExp
  creditRegex: RegExp
  amountRegex: RegExp
  dateRegex?: RegExp
  descRegex?: RegExp
}

const BANK_PATTERNS: BankPattern[] = [
  {
    name: "HDFC",
    // Real domain confirmed from actual emails: hdfcbank.bank.in
    senders: ["hdfcbank.bank.in", "hdfcbank.net", "hdfcbank.com"],
    debitRegex: /(?:debited|debit|spent|paid)/i,
    creditRegex: /(?:credited|credit|received)/i,
    amountRegex: /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i,
    descRegex: /(?:to VPA\s+\S+\s+|at|to|from|Info:|for)\s*([A-Za-z0-9 *\-/.@]+?)(?:\s+on|\s+Avl|\s+Bal|\.(?:\s|$)|$)/i,
  },
  {
    name: "ICICI",
    // Real domain confirmed from actual emails: icici.bank.in
    senders: ["icici.bank.in", "icicibank.com", "autoreply@icicibank.com"],
    debitRegex: /(?:debited|debit|spent|used for a transaction)/i,
    creditRegex: /(?:credited|credit|received)/i,
    amountRegex: /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i,
    descRegex: /(?:Info:|at|to)\s+([A-Za-z0-9 *\-/]+?)(?:\s+on|\.|,|$)/i,
  },
  {
    name: "SBI",
    senders: ["sbi.bank.in", "sbialert@sbi.co.in", "sbi.co.in"],
    debitRegex: /(?:debited|debit|withdrawn)/i,
    creditRegex: /(?:credited|credit|deposited)/i,
    amountRegex: /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i,
    descRegex: /(?:to|from|at)\s+([A-Za-z0-9 *\-/]+?)(?:\s+Ref|\s+on|\.)/i,
  },
  {
    name: "Axis",
    senders: ["axisbank.bank.in", "axis.bank.in", "axisbank.com"],
    debitRegex: /(?:debited|debit|spent)/i,
    creditRegex: /(?:credited|credit)/i,
    amountRegex: /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i,
    descRegex: /(?:at|to)\s+([A-Za-z0-9 *\-/]+?)(?:\s+on|\.|,)/i,
  },
  {
    name: "Kotak",
    senders: ["kotak.bank.in", "alerts@kotak.com", "kotak.com"],
    debitRegex: /(?:debited|debit|spent)/i,
    creditRegex: /(?:credited|credit)/i,
    amountRegex: /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i,
    descRegex: /(?:at|to)\s+([A-Za-z0-9 *\-/]+?)(?:\s+on|\.|,)/i,
  },
  {
    name: "PhonePe",
    senders: ["phonepe.com"],
    debitRegex: /(?:debited|paid|sent)/i,
    creditRegex: /(?:credited|received|got)/i,
    amountRegex: /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i,
    descRegex: /(?:to|from|paid to)\s+([A-Za-z0-9 .]+?)(?:\s+on|\s+via|\.|,)/i,
  },
  {
    name: "GPay",
    senders: ["google.com"],
    debitRegex: /(?:paid|sent|debited)/i,
    creditRegex: /(?:received|credited)/i,
    amountRegex: /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i,
    descRegex: /(?:to|from)\s+([A-Za-z0-9 .]+?)(?:\s+on|\s+using|\.|,)/i,
  },
  {
    name: "Paytm",
    senders: ["paytm.com"],
    debitRegex: /(?:debited|paid|spent)/i,
    creditRegex: /(?:credited|received)/i,
    amountRegex: /(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d*)/i,
    descRegex: /(?:to|from|at)\s+([A-Za-z0-9 .]+?)(?:\s+on|\.|,)/i,
  },
]

function parseAmount(str: string): number {
  return Math.round(parseFloat(str.replace(/,/g, "")) * 100)
}

export function detectBank(from: string): BankPattern | null {
  const fromLower = from.toLowerCase()
  return BANK_PATTERNS.find((p) => p.senders.some((s) => fromLower.includes(s))) ?? null
}

export function parseTransactionEmail(
  from: string,
  subject: string,
  body: string,
  receivedDate: Date
): ParsedTransaction | null {
  const bank = detectBank(from)
  if (!bank) return null

  const text = `${subject} ${body}`.replace(/\n/g, " ").replace(/\s+/g, " ")

  const amountMatch = text.match(bank.amountRegex)
  if (!amountMatch) return null

  const amount = parseAmount(amountMatch[1])
  if (amount <= 0 || amount > 100_000_000_00) return null // sanity check (>₹10cr suspicious)

  const isDebit = bank.debitRegex.test(text)
  const isCredit = bank.creditRegex.test(text)
  if (!isDebit && !isCredit) return null
  const type: "debit" | "credit" = isDebit ? "debit" : "credit"

  let rawDescription = ""
  if (bank.descRegex) {
    const m = text.match(bank.descRegex)
    if (m) rawDescription = m[1].trim()
  }
  if (!rawDescription) rawDescription = subject.slice(0, 80)

  // Try to extract date from email body, fall back to received date
  let date = receivedDate
  const dm = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/)
  if (dm) {
    const year = dm[3].length === 2 ? 2000 + parseInt(dm[3]) : parseInt(dm[3])
    const parsed = new Date(year, parseInt(dm[2]) - 1, parseInt(dm[1]))
    if (!isNaN(parsed.getTime())) date = parsed
  }

  return { amount, type, rawDescription, date, bank: bank.name }
}
