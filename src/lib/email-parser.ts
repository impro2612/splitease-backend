export interface ParsedTransaction {
  amount: number       // in paise
  type: "debit" | "credit"
  rawDescription: string
  date: Date
  bank: string
}

// Known bank sender domains — used only for bank name labeling, not as a parse gate
const BANK_DOMAINS: { domain: string; name: string }[] = [
  { domain: "hdfcbank.bank.in", name: "HDFC" },
  { domain: "hdfcbank.net",     name: "HDFC" },
  { domain: "hdfcbank.com",     name: "HDFC" },
  { domain: "icici.bank.in",    name: "ICICI" },
  { domain: "icicibank.com",    name: "ICICI" },
  { domain: "sbi.bank.in",      name: "SBI" },
  { domain: "sbi.co.in",        name: "SBI" },
  { domain: "axisbank.bank.in", name: "Axis" },
  { domain: "axis.bank.in",    name: "Axis" },   // real sender domain from actual emails
  { domain: "axisbank.com",    name: "Axis" },
  { domain: "kotak.bank.in",   name: "Kotak" },
  { domain: "kotak.com",       name: "Kotak" },
  { domain: "yesbank.bank.in", name: "Yes Bank" },
  { domain: "indusind.bank.in", name: "IndusInd" },
  { domain: "indusind.com",    name: "IndusInd" }, // real sender domain from actual emails
  { domain: "pnb.bank.in",      name: "PNB" },
  { domain: "idfcfirstbank.bank.in", name: "IDFC First" },
  { domain: "federalbank.bank.in",   name: "Federal Bank" },
  { domain: "rbl.bank.in",      name: "RBL" },
  { domain: "idbi.bank.in",     name: "IDBI" },
  { domain: "bob.bank.in",      name: "Bank of Baroda" },
  { domain: "unionbankofindia.bank.in", name: "Union Bank" },
  { domain: "canarabank.bank.in", name: "Canara Bank" },
  { domain: "sc.bank.in",       name: "Standard Chartered" },
  { domain: "phonepe.com",      name: "PhonePe" },
  { domain: "paytm.com",        name: "Paytm" },
  { domain: "google.com",       name: "GPay" },
  { domain: "amazon.in",        name: "Amazon Pay" },
  { domain: "bajajfinserv.in",  name: "Bajaj Finserv" },
]

// Signals that this email is a debit transaction
const DEBIT_PATTERNS = [
  /\b(?:has been |is |was )?debited\b/i,
  /\bused for a transaction\b/i,
  /\bupi (?:transaction|payment|transfer)\b/i,
  /\bneft (?:transaction|transfer|payment)\b/i,
  /\bimps (?:transaction|transfer|payment)\b/i,
  /\brtgs (?:transaction|transfer|payment)\b/i,
  /\b(?:payment|transfer) (?:of|for)\b/i,
  /\bpaid\b/i,
  /\bwithdrawn\b/i,
  /\bspent\b/i,
  /\bpurchase\b/i,
  /\btransacted\b/i,
  /\bhas been done\b/i,         // Kotak CC: "A Transaction of INR X has been done"
  /\bdebit card\b/i,            // IndusInd: "Your Debit Card shopping transaction was successful"
  /\bshopping transaction\b/i,  // IndusInd debit card alerts
]

// Signals that this email is a credit transaction
const CREDIT_PATTERNS = [
  /\b(?:has been |is |was )?credited\b/i,
  /\breceived\b/i,
  /\bdeposited\b/i,
  /\bmoney (?:added|received)\b/i,
  /\bcashback\b/i,
  /\brefund\b/i,
]

// Generic promotional / OTP / other filters — if any match, skip
const NON_TRANSACTION_PATTERNS = [
  /\b(?:otp|one.?time password)\b/i,
  /\bpre.?approved\b/i,
  /\bstatement\b/i,
  /\bpassword changed\b/i,
  /\bregistration\b/i,
  /\bnew (?:account|registration)\b/i,
  /\bcard (?:dispatched|delivered|activated)\b/i,
  /\bsecure your account\b/i,
  /\bclick here\b.*\bverify\b/i,
]

// Universal amount regex — matches Rs. 1,234.56 / INR 5000 / ₹999
const AMOUNT_REGEX = /(?:Rs\.?\s*|INR\s*|₹\s*)([\d,]+(?:\.\d{1,2})?)/i

// Ordered list of description extraction patterns (most specific first)
const DESC_PATTERNS: RegExp[] = [
  // UPI VPA: "to VPA user@upi" or "VPA: user@upi"
  /(?:to\s+VPA\s+|VPA:\s*)([A-Za-z0-9.\-_@]+)/i,
  // IndusInd UPI: "towards UPI/txnId/DR/PayeeName/Bank/vpa" — extract payee name
  /\btowards\s+UPI\/\d+\/(?:DR|CR)\/([^/]{2,40})\//i,
  // "Merchant Name: NAME" (Axis Bank, IndusInd structured emails)
  /\bMerchant\s+Name[:\s]+([A-Za-z0-9 *\-/.@&'*]+?)(?:\s*(?:Amount|Date|Time|Card|Available|Limit|Balance|\|)|\.|$)/i,
  // "against merchant NAME" (Kotak payment gateway)
  /\bagainst\s+merchant\s+([A-Za-z0-9 *\-/.@&']+?)(?:\s+on\b|\s+Ref|\s+vide|\.|,|$)/i,
  // "Info: MERCHANT NAME" (ICICI, Axis)
  /\bInfo[:\s]+([A-Za-z0-9 *\-/.@&']+?)(?:\s+Ref|\s+on\b|\s+Avl|\.|,|$)/i,
  // "at MERCHANT" (POS / online purchases)
  /\bat\s+([A-Za-z0-9 *\-/.@&']+?)(?:\s+on\b|\s+Ref|\s+Avl|\.|,|$)/i,
  // "to NAME" — UPI / transfers (avoid "to your", "to the")
  /\bto\s+(?!your\b|the\b|a\b)([A-Za-z0-9 *\-/.@&']{3,50}?)(?:\s+(?:on|via|using|Ref|Avl|Bal)\b|\.|,|$)/i,
  // "from NAME" — credits / receipts
  /\bfrom\s+(?!your\b|the\b|a\b)([A-Za-z0-9 *\-/.@&']{3,50}?)(?:\s+(?:on|via|Ref|Avl|Bal)\b|\.|,|$)/i,
  // "for NAME / DESCRIPTION"
  /\bfor\s+([A-Za-z0-9 *\-/.@&']{3,50}?)(?:\s+(?:on|via|Ref)\b|\.|,|$)/i,
  // NEFT/IMPS/UPI Ref / Txn IDs — extract payee between method and date/Ref
  /\b(?:NEFT|IMPS|RTGS|UPI)[- ](?:transfer|payment|transaction)?\s+(?:to|from)\s+([A-Za-z0-9 *\-/.@&']{3,50}?)(?:\s+(?:on|Ref)|\.|,|$)/i,
]

function detectBankName(from: string): string {
  const lower = from.toLowerCase()
  return BANK_DOMAINS.find((b) => lower.includes(b.domain))?.name ?? "Unknown"
}

function parseAmount(str: string): number {
  return Math.round(parseFloat(str.replace(/,/g, "")) * 100)
}

function extractDescription(text: string): string {
  for (const pattern of DESC_PATTERNS) {
    const m = text.match(pattern)
    if (m && m[1]) {
      const desc = m[1].trim().replace(/\s+/g, " ")
      if (desc.length >= 2) return desc
    }
  }
  return ""
}

function extractDate(text: string, fallback: Date): Date {
  // dd-mm-yyyy or dd/mm/yyyy or dd-mm-yy
  const dm = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/)
  if (dm) {
    const year = dm[3].length === 2 ? 2000 + parseInt(dm[3]) : parseInt(dm[3])
    const month = parseInt(dm[2]) - 1
    const day = parseInt(dm[1])
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) return d
    }
  }
  // yyyy-mm-dd (ISO style)
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
    if (!isNaN(d.getTime())) return d
  }
  return fallback
}

export function parseTransactionEmail(
  from: string,
  subject: string,
  body: string,
  receivedDate: Date
): ParsedTransaction | null {
  const bankName = detectBankName(from)

  const text = `${subject} ${body}`.replace(/\n/g, " ").replace(/\s+/g, " ")

  // Reject non-transaction emails early
  for (const bad of NON_TRANSACTION_PATTERNS) {
    if (bad.test(text)) return null
  }

  // Must have an amount
  const amountMatch = text.match(AMOUNT_REGEX)
  if (!amountMatch) return null
  const amount = parseAmount(amountMatch[1])
  if (amount <= 0 || amount > 10_000_000_00) return null // > ₹1Cr is suspicious

  // Determine transaction type
  const isDebit  = DEBIT_PATTERNS.some((p)  => p.test(text))
  const isCredit = CREDIT_PATTERNS.some((p) => p.test(text))
  if (!isDebit && !isCredit) return null
  // Debit takes priority when both match (e.g., "debited" + "credited Avl balance")
  const type: "debit" | "credit" = isDebit ? "debit" : "credit"

  const rawDescription = extractDescription(text) || subject.slice(0, 80)
  const date = extractDate(text, receivedDate)

  return { amount, type, rawDescription, date, bank: bankName }
}

// Re-export detectBank for any callers that used the old API
export function detectBank(from: string): { name: string } | null {
  const name = detectBankName(from)
  return name !== "Unknown" ? { name } : null
}
