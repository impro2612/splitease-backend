import { GoogleGenerativeAI } from "@google/generative-ai"

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

// Reject these emails before any parsing — they are NOT real transactions
const NON_TRANSACTION_PATTERNS = [
  // Security / account management
  /\b(?:otp|one.?time password)\b/i,
  /\bpassword\s+(?:changed|reset|updated)\b/i,
  /\bsecure\s+your\s+account\b/i,
  /\bclick\s+here\b.*\bverify\b/i,
  /\bnew\s+(?:account|registration|device|login)\b/i,
  /\bregistration\s+(?:successful|complete)\b/i,
  /\bcard\s+(?:dispatched|delivered|activated|blocked|unblocked)\b/i,

  // Promotional / marketing — loan & credit offers
  /\bpre.?approved\b/i,
  /\bjumbo\s+loan\b/i,
  /\b(?:personal|home|car|gold|education)\s+loan\s+(?:offer|approved|eligible|available)\b/i,
  /\bget\s+a\s+loan\b/i,
  /\bapply\s+(?:now|for)\b.*\bloan\b/i,
  /\bloan\s+offer\b/i,
  /\bcredit\s+limit\s+(?:increased|enhanced|raised)\b/i,
  /\bwhy\s+stop\b/i,                        // "Why Stop At 1 Card?"
  /\bclaim\s+your\s+(?:free|reward|gift)\b/i,

  // Rewards / cashback OFFERS (not actual cashback credited — those say "cashback credited")
  /\bworth\s+(?:of\s+)?rewards?\b/i,         // "₹250 Worth Rewards"
  /\brewards?\s+(?:earned|unlocked|waiting|expiring)\b/i,
  /\btransactions?\s+=\s*[₹Rs].*rewards?\b/i, // "2 Transactions = ₹250 Worth Rewards"
  /\bunlock(?:ed)?\s+(?:offer|reward|benefit|cashback)\b/i,
  /\byou(?:'ve|\s+have)\s+earned\b/i,

  // Credit score & financial health marketing
  /\bcredit\s+score\b/i,
  /\bfinancial\s+record\s+has\b/i,           // "Your Strong Financial Record Has Unlocked"
  /\bcibil\b/i,

  // Generic marketing signals
  /\bauto.?generated\s*(?:email|mail|message)\b/i,
  /\bprice\s+slash(?:ed)?\b/i,
  /\bexclusive\s+offer\b/i,
  /\bspecial\s+offer\b/i,
  /\blimited\s+(?:time\s+)?offer\b/i,
  /\bwelcome\s+(?:to|bonus|gift)\b/i,
  /\b(?:congratulations|congrats)[,!]?\s+you(?:'ve)?\b/i,

  // Statements & summaries (not individual transactions)
  /\bmonthly\s+statement\b/i,
  /\bstatement\s+(?:for|of|is\s+ready)\b/i,
  /\bmini\s+statement\b/i,

  // Minimum due / payment reminders (not a debit event)
  /\bminimum\s+(?:amount\s+)?due\b/i,
  /\bpayment\s+due\s+(?:date|reminder)\b/i,
  /\bdue\s+date\s+reminder\b/i,
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

const WEAK_LABEL_PATTERNS = [
  /^banking with us$/i,
  /^account\s*\d{2,}$/i,
  /^account\s*x{2,}\d{2,}$/i,
  /^dear customer$/i,
  /^transaction alert$/i,
  /^credit card statement$/i,
  /^statement(?: for)?$/i,
  /^bank(?:ing)? alert$/i,
  /^hdfc bank instaalerts$/i,
  /^axis mobile$/i,
  /^icici bank credit cards$/i,
  /^payment due(?: reminder)?$/i,
  /^minimum amount due$/i,
]

const labelCache = new Map<string, string>()

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

function cleanupLabel(label: string): string {
  return label
    .replace(/\b(?:dear customer|warm regards|thank you)\b/gi, " ")
    .replace(/\b(?:account|card)\s*(?:no\.?|number)?\s*[x*]*\d{2,}\b/gi, " ")
    .replace(/\b(?:ref(?:erence)?|txn|trn)\s*(?:no\.?|number)?\s*[:#-]?\s*[A-Z0-9-]{6,}\b/gi, " ")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-,:.\s]+|[-,:.\s]+$/g, "")
    .slice(0, 80)
}

export function isWeakTransactionLabel(label: string): boolean {
  const cleaned = cleanupLabel(label)
  if (!cleaned) return true
  if (cleaned.length < 3) return true
  if (WEAK_LABEL_PATTERNS.some((p) => p.test(cleaned))) return true
  if (/^\d+$/.test(cleaned.replace(/\s+/g, ""))) return true
  if (!/[A-Za-z]/.test(cleaned)) return true
  if (/^(?:bank|banking|account|credit|debit|payment|transaction)(?:\s|$)/i.test(cleaned) && cleaned.split(/\s+/).length <= 3) {
    return true
  }
  return false
}

type LabelInput = {
  key: string
  from: string
  bank: string
  subject: string
  body: string
  currentLabel: string
}

function buildLabelPrompt(batch: LabelInput[]): string {
  return `Extract the best short merchant/payee label from each bank transaction email.

Rules:
- Return a short merchant/payee label in Title Case, ideally 2 to 5 words.
- Do NOT return bank names, generic phrases, account numbers, dates, references, or greeting text.
- Good examples: "CRED Club", "Dreamplug Paytech", "BigTree Entertainment", "Zomato", "Amazon Pay".
- If there is no clear merchant/payee, return "Unknown Merchant".
- Reply ONLY as JSON array: [{"key":"...","label":"..."}]

${batch.map((item) => {
  const snippet = cleanupLabel(`${item.subject} ${item.body}`).slice(0, 900)
  return [
    `key: ${item.key}`,
    `bank: ${item.bank}`,
    `from: ${item.from}`,
    `currentLabel: ${item.currentLabel}`,
    `emailText: ${snippet}`,
  ].join("\n")
}).join("\n\n---\n\n")}`
}

export async function batchExtractMerchantLabelsWithAI(
  items: LabelInput[]
): Promise<Record<string, string>> {
  if (!process.env.GEMINI_API_KEY || items.length === 0) return {}

  const pending = items.filter((item) => !labelCache.has(item.key))
  const result: Record<string, string> = {}

  for (const item of items) {
    const cached = labelCache.get(item.key)
    if (cached) result[item.key] = cached
  }

  if (pending.length === 0) return result

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { maxOutputTokens: 1024, temperature: 0 },
  })

  for (let i = 0; i < pending.length; i += 20) {
    const batch = pending.slice(i, i + 20)
    try {
      const response = await model.generateContent(buildLabelPrompt(batch))
      const text = response.response.text().trim()
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) continue

      const parsed = JSON.parse(jsonMatch[0]) as { key: string; label: string }[]
      for (const row of parsed) {
        if (!row?.key || !row?.label) continue
        const cleaned = cleanupLabel(row.label)
        if (!cleaned || /^unknown merchant$/i.test(cleaned)) continue
        labelCache.set(row.key, cleaned)
        result[row.key] = cleaned
      }
    } catch (err) {
      console.error("Gemini label extraction error:", err)
    }
  }

  return result
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
  if (amount <= 0 || amount > 5_000_000_00) return null // > ₹50L single transaction is implausible

  // This app is expense-only — only debit transactions are imported
  const isDebit = DEBIT_PATTERNS.some((p) => p.test(text))
  if (!isDebit) return null
  const type = "debit" as const

  const rawDescription = cleanupLabel(extractDescription(text) || subject.slice(0, 80))
  const date = extractDate(text, receivedDate)

  return { amount, type, rawDescription, date, bank: bankName }
}

// Re-export detectBank for any callers that used the old API
export function detectBank(from: string): { name: string } | null {
  const name = detectBankName(from)
  return name !== "Unknown" ? { name } : null
}
