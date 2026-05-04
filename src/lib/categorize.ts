import crypto from "crypto"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const CATEGORIES = [
  "Salary / Income",
  "Food / Dining",
  "Rent / Housing",
  "Transport",
  "Travel",
  "Shopping",
  "Subscriptions",
  "UPI Payments",
  "Transfers",
  "Bills / Utilities",
  "EMI / Loans",
  "Credit Card Payments",
  "Medical / Pharmacy",
  "Bank Charges",
  "Miscellaneous",
] as const

export type Category = (typeof CATEGORIES)[number]

type Intent =
  | "salary_income"
  | "merchant_spend"
  | "p2p_transfer"
  | "credit_card_payment"
  | "loan_emi"
  | "subscription_payment"
  | "utility_bill"
  | "medical_spend"
  | "bank_charge"
  | "miscellaneous"

type ClassificationInput = {
  rawDescription: string
  type: "debit" | "credit"
}

export type ClassificationResult = {
  description: string
  category: Category
  intent: Intent
  confidence: "high" | "medium" | "low"
}

export type AIRefineInput = {
  key: string
  rawDescription: string
  description: string
  type: "debit" | "credit"
  category: Category
  intent: Intent
}

type AIRefineResult = {
  description: string
  category: Category
}

const categoryCache = new Map<string, AIRefineResult>()

const LABEL_ALIASES: Array<{ pattern: RegExp; label: string; category?: Category; intent?: Intent }> = [
  { pattern: /\bCRED(CLUB)?\b|PAYMENT ON CRED/i, label: "CRED Club", category: "Credit Card Payments", intent: "credit_card_payment" },
  { pattern: /\bSWIGGY(DINEOUT|DINERS)?\b/i, label: "Swiggy", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bZOMATO\b/i, label: "Zomato", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bEATCLUB\b|\bEAT\.?CLUB\b|\bBOX8\b|\bFAASOS\b/i, label: "EatClub", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bDOMINOS?\b|\bPIZZA HUT\b|\bMCDONALD'?S\b|\bKFC\b|\bBURGER KING\b|\bSUBWAY\b|\bSTARBUCKS\b/i, label: "Restaurant", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bANNAPURNA\b.*\bFOODS?\b|\bANNAPURNA\s+FOODS?\b/i, label: "Annapurna Foods", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bWAFFLE\b/i, label: "Waffle Binge", category: "Food / Dining", intent: "merchant_spend" },
  { pattern: /\bFLIPKART\b/i, label: "Flipkart", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bAMAZON\b/i, label: "Amazon", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bMYNTRA\b/i, label: "Myntra", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bAJIO\b/i, label: "Ajio", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bNYKAA\b/i, label: "Nykaa", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bMEESHO\b/i, label: "Meesho", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bJIOMART\b/i, label: "JioMart", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bBIGBASKET\b/i, label: "BigBasket", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bZEPTO\b/i, label: "Zepto", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bBLINKIT\b|\bGROFERS\b/i, label: "Blinkit", category: "Shopping", intent: "merchant_spend" },
  { pattern: /\bMAKEMYTRIP\b|\bMAKE\s*MY\s*TRIP\b/i, label: "MakeMyTrip", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bGOIBIBO\b/i, label: "Goibibo", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bCLEARTRIP\b/i, label: "Cleartrip", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bAGODA\b/i, label: "Agoda", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bBOOKING\.?COM\b|\bBOOKING COM\b/i, label: "Booking.com", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bYATRA\b/i, label: "Yatra", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bIXIGO\b/i, label: "Ixigo", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bEASEMYTRIP\b/i, label: "EaseMyTrip", category: "Travel", intent: "merchant_spend" },
  { pattern: /\bOLA\b/i, label: "Ola", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bUBER\b/i, label: "Uber", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bRAPIDO\b/i, label: "Rapido", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bLYFT\b/i, label: "Lyft", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bBOLT\b/i, label: "Bolt", category: "Transport", intent: "merchant_spend" },
  { pattern: /\bPAYTM\b.*\bEXPRESS\b|\bWEB\s+UPI\b.*\bPAYTM\b/i, label: "Paytm", category: "Bills / Utilities", intent: "utility_bill" },
  { pattern: /\bDTDC\b/i, label: "DTDC", category: "Bills / Utilities", intent: "merchant_spend" },
  { pattern: /\bANGEL\b.*\bCHEMIST\b|\bCHEMIST\b|\bPHARMACY\b|\bMEDPLUS\b|\bAPOLLO\b|\bNETMEDS\b|\bPHARMEASY\b|\b1MG\b/i, label: "Pharmacy", category: "Medical / Pharmacy", intent: "medical_spend" },
  { pattern: /\bRAZORPAY\b/i, label: "Razorpay", category: "Bills / Utilities", intent: "merchant_spend" },
  { pattern: /\bHDFC\s+BANK\s+LTD\b/i, label: "HDFC Bank Ltd", category: "EMI / Loans", intent: "loan_emi" },
  { pattern: /\bLAMBDATEST\b.*\bPRIVATE\b.*\bLIMITED\b/i, label: "LambdaTest India Private Limited", category: "Salary / Income", intent: "salary_income" },
  { pattern: /\bNETFLIX\b|\bSPOTIFY\b|\bHOTSTAR\b|\bYOUTUBE PREMIUM\b|\bAMAZON PRIME\b/i, label: "Subscription", category: "Subscriptions", intent: "subscription_payment" },
]

const BANKING_NOISE = [
  "UPIINTENT",
  "NO REMARKS",
  "PAYMENT ON CRED",
  "PAYMENTONCRED",
  "UTIB",
  "UBIN",
  "ICICI",
  "HDFCBANK",
  "HDFC",
  "AXISB",
  "PAYU",
  "OKICICI",
  "OKHDFC",
  "OKSBI",
  "YBL",
  "YESBOYBLUPI",
  "YESBOPTMUPI",
  "MCHUPI",
  "SBOYBLUPI",
  "DFCBANK",
]

const BUSINESS_MARKERS = [
  "LTD",
  "LIMITED",
  "PRIVATE",
  "PVT",
  "TECHNOLOGIES",
  "SOLUTIONS",
  "SOFTWARE",
  "SERVICES",
  "VENTURES",
  "LABS",
  "RETAIL",
  "DIGITAL",
  "INTERNET",
  "LOGISTICS",
  "SUPERMARKET",
  "STORE",
  "STORES",
  "MART",
  "EXPRESS",
  "FINANCE",
  "BANK",
  "PHARMACY",
  "CHEMIST",
  "MARKETPLACE",
  "ONLINE",
  "FOODS",
  "FOODS",
  "TRAVEL",
  "TRIP",
  "PAYMENTS",
  "PAYTM",
  "PINELABS",
  "BIGBASKET",
  "BLINKIT",
  "ZEPTO",
  "MAKEMYTRIP",
  "GOIBIBO",
  "CLEARTRIP",
  "AGODA",
  "BOOKING",
  "IXIGO",
  "EASEMYTRIP",
  "ANNAPURNA",
  "LAMBDATEST",
  "RAZORPAY",
  "CREDCLUB",
  "FLIPKART",
  "SWIGGY",
  "ZOMATO",
  "DTDC",
]

const CATEGORY_RULES: Array<{ category: Category; intent: Intent; patterns: RegExp[] }> = [
  {
    category: "Salary / Income",
    intent: "salary_income",
    patterns: [
      /\bSALARY\b/i,
      /\bPAYROLL\b/i,
      /\bBONUS\b/i,
      /\bINCENTIVE\b/i,
      /\bSTIPEND\b/i,
      /\bREIMBURSEMENT\b/i,
      /\bREFUND\b/i,
      /\bCASHBACK\b/i,
      /\bCREDITED BY\b/i,
      /\bSAL\s*CR\b/i,
      /\bLAMBDATEST\b/i,
    ],
  },
  {
    category: "Credit Card Payments",
    intent: "credit_card_payment",
    patterns: [/\bCRED(CLUB)?\b/i, /\bPAYMENT ON CRED\b/i, /\bCREDIT CARD\b/i, /\bCC PAYMENT\b/i],
  },
  {
    category: "EMI / Loans",
    intent: "loan_emi",
    patterns: [
      /\bACH ?D\b/i,
      /\bACHD\b/i,
      /\bNACH\b/i,
      /\bECS\b/i,
      /\bMANDATE\b/i,
      /\bEMI\b/i,
      /\bLOAN\b/i,
      /\bHL DEBIT\b/i,
      /\bBAJAJ\b/i,
      /\bFINANCE\b/i,
      /\bINSURANCE PREMIUM\b/i,
    ],
  },
  {
    category: "Bank Charges",
    intent: "bank_charge",
    patterns: [/\bCHARGE(S)?\b/i, /\bPENALTY\b/i, /\bINTEREST\b/i, /\bGST\b/i, /\bANNUAL FEE\b/i],
  },
  {
    category: "Subscriptions",
    intent: "subscription_payment",
    patterns: [/\bNETFLIX\b/i, /\bSPOTIFY\b/i, /\bHOTSTAR\b/i, /\bYOUTUBE PREMIUM\b/i, /\bAMAZON PRIME\b/i],
  },
  {
    category: "Food / Dining",
    intent: "merchant_spend",
    patterns: [/\bSWIGGY\b/i, /\bZOMATO\b/i, /\bPIZZA\b/i, /\bRESTAURANT\b/i, /\bCAFE\b/i, /\bWAFFLE\b/i, /\bANNAPURNA\b/i, /\bDOMINOS?\b/i, /\bPIZZA HUT\b/i, /\bMCDONALD'?S\b/i, /\bKFC\b/i, /\bBURGER KING\b/i, /\bSUBWAY\b/i, /\bSTARBUCKS\b/i],
  },
  {
    category: "Shopping",
    intent: "merchant_spend",
    patterns: [/\bFLIPKART\b/i, /\bAMAZON\b/i, /\bMYNTRA\b/i, /\bAJIO\b/i, /\bNYKAA\b/i, /\bBIGBASKET\b/i, /\bZEPTO\b/i, /\bBLINKIT\b/i, /\bMEESHO\b/i, /\bJIOMART\b/i],
  },
  {
    category: "Travel",
    intent: "merchant_spend",
    patterns: [/\bMAKEMYTRIP\b/i, /\bMAKE\s*MY\s*TRIP\b/i, /\bGOIBIBO\b/i, /\bIRCTC\b/i, /\bYATRA\b/i, /\bAGODA\b/i, /\bBOOKING\.?COM\b/i, /\bIXIGO\b/i, /\bEASEMYTRIP\b/i],
  },
  {
    category: "Medical / Pharmacy",
    intent: "medical_spend",
    patterns: [/\bCHEMIST\b/i, /\bPHARMACY\b/i, /\bMEDICAL\b/i, /\bMEDPLUS\b/i, /\bAPOLLO\b/i],
  },
  {
    category: "Bills / Utilities",
    intent: "utility_bill",
    patterns: [/\bAIRTEL\b/i, /\bJIO\b/i, /\bBSNL\b/i, /\bBROADBAND\b/i, /\bELECTRICITY\b/i, /\bWATER\b/i, /\bGAS\b/i, /\bDTDC\b/i, /\bPAYTM\b.*\bEXPRESS\b/i, /\bWEB\s+UPI\b.*\bPAYTM\b/i, /\bMOBILE RECHARGE\b/i, /\bPOSTPAID\b/i, /\bFASTAG\b/i],
  },
  {
    category: "Transport",
    intent: "merchant_spend",
    patterns: [/\bOLA\b/i, /\bUBER\b/i, /\bRAPIDO\b/i, /\bLYFT\b/i, /\bBOLT\b/i, /\bFASTAG\b/i, /\bFUEL\b/i, /\bPETROL\b/i, /\bDIESEL\b/i, /\bMETRO\b/i],
  },
  {
    category: "Rent / Housing",
    intent: "merchant_spend",
    patterns: [/\bRENT\b/i, /\bLANDLORD\b/i, /\bSOCIETY\b/i, /\bMAINTENANCE\b/i],
  },
]

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ")
}

function uniqueTokens(tokens: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const key = token.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
  }
  return out
}

function extractAlias(raw: string) {
  return LABEL_ALIASES.find((alias) => alias.pattern.test(raw))
}

function stripRailPrefix(raw: string): string {
  return raw
    .replace(/^(UPI|IMPS|NEFT(?:\s+CR|\s+DR)?|RTGS(?:\s+CR|\s+DR)?|ACH\s*D|ACHD|NACH|ECS|HL)\s*[-:\s]*/i, "")
    .replace(/\b(CR|DR)\b\s*[-:\s]*/i, "")
}

function splitBeforeNoise(raw: string): string {
  const upper = raw.toUpperCase()
  const candidates = [
    upper.indexOf("@"),
    upper.indexOf(" NO REMARKS"),
    upper.indexOf(" UPIINTENT"),
    upper.indexOf(" PAYMENT ON CRED"),
  ].filter((idx) => idx >= 0)
  if (!candidates.length) return raw
  return raw.slice(0, Math.min(...candidates))
}

function extractAlphaTokens(raw: string): string[] {
  const cleaned = splitBeforeNoise(stripRailPrefix(raw))
    .replace(/[._]/g, " ")
    .replace(/[^A-Za-z\s-]/g, " ")
    .replace(/-/g, " ")
  return cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !BANKING_NOISE.includes(token.toUpperCase()))
}

function extractEntityLabel(raw: string): string {
  const alias = extractAlias(raw)
  if (alias) return alias.label

  const tokens = uniqueTokens(extractAlphaTokens(raw))
  if (!tokens.length) return "Miscellaneous"

  const ltdIdx = tokens.findIndex((token) => ["LIMITED", "LTD", "PRIVATE", "PVT"].includes(token.toUpperCase()))
  if (ltdIdx >= 0) {
    return toTitleCase(tokens.slice(0, Math.min(tokens.length, ltdIdx + 1)).join(" ")).slice(0, 48)
  }

  const businessToken = tokens.find((token) => BUSINESS_MARKERS.includes(token.toUpperCase()))
  if (businessToken) {
    const start = tokens.findIndex((token) => token.toUpperCase() === businessToken.toUpperCase())
    const slice = tokens.slice(Math.max(0, start - 1), Math.min(tokens.length, start + 3))
    return toTitleCase(slice.join(" ")).slice(0, 40)
  }

  return toTitleCase(tokens.slice(0, 4).join(" ")).slice(0, 40)
}

function looksLikePerson(label: string): boolean {
  const tokens = label.split(/\s+/).filter(Boolean)
  if (tokens.length < 2 || tokens.length > 4) return false
  if (tokens.some((token) => BUSINESS_MARKERS.includes(token.toUpperCase()))) return false
  return tokens.every((token) => /^[A-Za-z]+$/.test(token))
}

function looksLikeBusiness(raw: string, label: string): boolean {
  if (extractAlias(raw)) return true
  const upper = `${raw} ${label}`.toUpperCase()
  if (BUSINESS_MARKERS.some((token) => upper.includes(token))) return true
  if (/\b(LTD|LIMITED|PRIVATE|PVT|LLP|INC|TECHNOLOGIES|SOLUTIONS|SERVICES|ONLINE|MARKETPLACE|FOODS|PAYTM|PINELABS|LABS|VENTURES|RETAIL|DIGITAL|INTERNET|LOGISTICS|STORE|STORES|MART)\b/i.test(upper)) return true
  return false
}

function looksLikeEmployerIncome(raw: string, type: "debit" | "credit"): boolean {
  if (type !== "credit") return false
  if (!hasTransferRail(raw)) return false
  const upper = raw.toUpperCase()
  if (/\b(REFUND|CASHBACK|REVERSAL|REWARD|INTEREST)\b/.test(upper)) return false
  return looksLikeBusiness(raw, extractEntityLabel(raw))
}

function isNoisyLabel(label: string): boolean {
  const upper = label.toUpperCase()
  return (
    label.length < 3 ||
    /\d{4,}/.test(label) ||
    /[@]/.test(label) ||
    BANKING_NOISE.some((token) => upper.includes(token)) ||
    upper === "MISCELLANEOUS"
  )
}

function hasTransferRail(raw: string): boolean {
  return /\b(NEFT|IMPS|RTGS)\b/i.test(raw)
}

function hasUpiRail(raw: string): boolean {
  return /\bUPI\b/i.test(raw)
}

export function classifyTransaction({ rawDescription, type }: ClassificationInput): ClassificationResult {
  const raw = compactWhitespace(rawDescription)
  const alias = extractAlias(raw)
  const label = extractEntityLabel(raw)

  if (looksLikeEmployerIncome(raw, type)) {
    return {
      description: label,
      category: "Salary / Income",
      intent: "salary_income",
      confidence: "high",
    }
  }

  if (hasTransferRail(raw)) {
    return {
      description: label,
      category: "Transfers",
      intent: "p2p_transfer",
      confidence: "high",
    }
  }

  if (alias?.category && alias?.intent) {
    return {
      description: alias.label,
      category: alias.category,
      intent: alias.intent,
      confidence: "high",
    }
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(raw))) {
      return {
        description: label,
        category: rule.category,
        intent: rule.intent,
        confidence: "high",
      }
    }
  }

  if (hasUpiRail(raw) && looksLikePerson(label)) {
    return {
      description: label,
      category: "UPI Payments",
      intent: "merchant_spend",
      confidence: "medium",
    }
  }

  if (hasUpiRail(raw)) {
    return {
      description: label,
      category: looksLikeBusiness(raw, label) ? "Miscellaneous" : "UPI Payments",
      intent: "merchant_spend",
      confidence: looksLikeBusiness(raw, label) || isNoisyLabel(label) ? "low" : "medium",
    }
  }

  return {
    description: label,
    category: "Miscellaneous",
    intent: "miscellaneous",
    confidence: isNoisyLabel(label) ? "low" : "medium",
  }
}

export function normalizeDescription(raw: string): string {
  return classifyTransaction({ rawDescription: raw, type: "debit" }).description
}

export function categorizeByRules(description: string): Category {
  return classifyTransaction({ rawDescription: description, type: "debit" }).category
}

export function shouldRefineWithAI(result: ClassificationResult, rawDescription: string): boolean {
  if (result.category === "Miscellaneous") return true
  if (result.confidence === "low") return true
  if (result.category === "Transfers" && /\b(PAYU|RAZORPAY|LTD|PRIVATE|TECHNOLOGIES)\b/i.test(rawDescription)) return true
  if (result.category === "UPI Payments" && !looksLikePerson(result.description)) return true
  if (hasUpiRail(rawDescription) && looksLikeBusiness(rawDescription, result.description)) return true
  if (result.category === "Salary / Income" && /\b(REFUND|CASHBACK|REVERSAL|REWARD)\b/i.test(rawDescription)) return true
  return isNoisyLabel(result.description)
}

export async function batchRefineTransactionsWithAI(inputs: AIRefineInput[]): Promise<Record<string, AIRefineResult>> {
  if (!process.env.GEMINI_API_KEY || inputs.length === 0) return {}

  const unique = inputs.filter((item) => !categoryCache.has(item.key)).slice(0, 40)
  const resultMap: Record<string, AIRefineResult> = {}

  for (const item of inputs) {
    const cached = categoryCache.get(item.key)
    if (cached) resultMap[item.key] = cached
  }

  if (!unique.length) return resultMap

  const prompt = `
You classify Indian bank-statement transactions.

Allowed categories: ${CATEGORIES.join(" | ")}

Rules:
- CRED / PAYMENT ON CRED => Credit Card Payments
- ACH D / NACH / ECS / mandate debits => EMI / Loans unless clearly bank fees
- NEFT / IMPS / RTGS => Transfers
- UPI with company/merchant names => classify by merchant (Swiggy => Food / Dining, Flipkart/BigBasket/Zepto => Shopping, MakeMyTrip => Travel, Paytm Express/Web UPI => Bills / Utilities, etc.)
- Popular merchant hints:
  - Food / Dining: Swiggy, Zomato, EatClub, Box8, Faasos, Domino's, Pizza Hut, McDonald's, KFC, Burger King, Subway, Starbucks, Annapurna Foods
  - Shopping: Flipkart, Amazon, Myntra, Ajio, Nykaa, Meesho, JioMart, BigBasket, Zepto, Blinkit
  - Travel: MakeMyTrip, Goibibo, Cleartrip, Agoda, Booking.com, Yatra, Ixigo, EaseMyTrip
  - Transport: Ola, Uber, Rapido, Lyft, Bolt
  - Medical / Pharmacy: MedPlus, Apollo, NetMeds, PharmEasy, Angel Chemist
- UPI with only person/payee names and no clear merchant => UPI Payments
- Employer/company incoming NEFT/IMPS/RTGS credits => Salary / Income
- Chemist/pharmacy/medical stores => Medical / Pharmacy
- Charges/fees/penalty/interest => Bank Charges
- Swiggy/Zomato => Food / Dining
- Flipkart/Amazon/Myntra => Shopping
- MakeMyTrip / GoIbibo / Yatra => Travel

Return ONLY JSON array.
Each item must be:
{"key":"...","label":"Short Clean Label","category":"One Allowed Category"}

Keep label short, human-readable, 2-5 words, no refs/account numbers.

Transactions:
${unique.map((item) => JSON.stringify({
  key: item.key,
  raw: item.rawDescription,
  currentLabel: item.description,
  currentCategory: item.category,
  type: item.type,
  intentHint: item.intent,
})).join("\n")}
`.trim()

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      generationConfig: { maxOutputTokens: 2048, temperature: 0 },
    })

    const response = await model.generateContent(prompt)
    const text = response.response.text().trim()
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return resultMap

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ key: string; label: string; category: string }>
    for (const item of parsed) {
      if (!item?.key || !item?.label || !CATEGORIES.includes(item.category as Category)) continue
      const refined = {
        description: compactWhitespace(item.label).slice(0, 48),
        category: item.category as Category,
      }
      categoryCache.set(item.key, refined)
      resultMap[item.key] = refined
    }

    return resultMap
  } catch (err) {
    console.error("Gemini classify error:", err)
    return resultMap
  }
}

export async function batchCategorizeWithAI(descriptions: string[]): Promise<Record<string, Category>> {
  const inputs = descriptions.map((description) => ({
    key: description,
    rawDescription: description,
    description,
    type: "debit" as const,
    category: "Miscellaneous" as const,
    intent: "miscellaneous" as const,
  }))
  const refined = await batchRefineTransactionsWithAI(inputs)
  const out: Record<string, Category> = {}
  for (const [key, value] of Object.entries(refined)) out[key] = value.category
  return out
}

export function makeHash(userId: string, date: string, amount: number, rawDesc: string): string {
  return crypto
    .createHash("sha1")
    .update(`${userId}|${date}|${amount}|${rawDesc.toLowerCase().trim()}`)
    .digest("hex")
}
