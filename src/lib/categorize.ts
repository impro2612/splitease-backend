import Anthropic from "@anthropic-ai/sdk"
import crypto from "crypto"

export const CATEGORIES = [
  "Salary / Income",
  "Food / Dining",
  "Rent / Housing",
  "Transport",
  "Shopping",
  "Subscriptions",
  "Transfers",
  "Bills / Utilities",
  "EMI / Loans",
  "Miscellaneous",
] as const

export type Category = (typeof CATEGORIES)[number]

// Keyword rules — handles ~80% of Indian transactions instantly
const RULES: Record<Category, string[]> = {
  "Salary / Income": [
    "salary", "payroll", "credited by", "neft cr", "imps cr", "upi cr",
    "bonus", "incentive", "reimbursement", "refund", "cashback",
  ],
  "Food / Dining": [
    "zomato", "swiggy", "dominos", "domino", "pizza hut", "kfc", "mcdonalds",
    "mcdonald", "burger king", "subway", "starbucks", "cafe coffee day", "ccd",
    "dunkin", "haldiram", "barbeque", "bbq", "chaayos", "chai point",
    "restaurant", "dining", "food", "biryani", "kitchen", "dhaba", "bakery",
    "hotel", "cafe", "canteen", "eatery",
  ],
  "Transport": [
    "ola", "uber", "rapido", "metro", "irctc", "indigo", "spicejet",
    "air india", "airindia", "goindigo", "vistara", "akasa", "makemytrip",
    "yatra", "petrol", "fuel", "iocl", "bpcl", "hpcl", "parking",
    "fastag", "toll", "cab", "taxi", "auto", "rickshaw", "paytm fastag",
    "redbus",
  ],
  "Shopping": [
    "amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho", "zepto",
    "blinkit", "bigbasket", "instamart", "dmart", "reliance retail",
    "jiomart", "tatacliq", "snapdeal", "lenskart", "pepperfry", "ikea",
    "lifestyle", "shoppers stop", "westside", "max fashion", "h&m", "zara",
    "pantaloons",
  ],
  "Subscriptions": [
    "netflix", "spotify", "prime video", "amazon prime", "hotstar",
    "disney+", "youtube premium", "apple music", "apple tv", "icloud",
    "google one", "google play", "playstore", "zee5", "sonyliv",
    "jiocinema", "voot", "mxplayer", "crunchyroll", "adobe", "microsoft 365",
  ],
  "Bills / Utilities": [
    "electricity", "bescom", "tata power", "mseb", "adani electricity",
    "torrent power", "airtel", "jio postpaid", "bsnl", "vi ", "vodafone",
    "water bill", "gas bill", "piped gas", "mgl", "igl", "broadband",
    "postpaid bill", "recharge", "bill payment", "bbps", "municipal",
    "property tax", "lwf",
  ],
  "Rent / Housing": [
    "rent", "landlord", "house rent", "maintenance charge", "society",
    "apartment", "flat rent", "pg ", "hostel", "stayabode", "nestaway",
    "oyo life", "colive", "nobroker",
  ],
  "Transfers": [
    "neft", "imps", "rtgs", "self transfer", "own account",
    "transfer to", "transfer from", "fund transfer",
  ],
  "EMI / Loans": [
    "emi", "loan repayment", "loan emi", "home loan", "car loan",
    "personal loan", "bajaj finserv", "hdfc loan", "icici loan",
    "equated monthly", "bajaj finance", "zerodha", "groww", "smallcase",
    "mf", "mutual fund sip", "sip",
  ],
  Miscellaneous: [],
}

export function categorizeByRules(description: string): Category {
  const lower = description.toLowerCase()
  for (const [category, keywords] of Object.entries(RULES) as [Category, string[]][]) {
    if (category === "Miscellaneous") continue
    if (keywords.some((kw) => lower.includes(kw))) return category
  }
  return "Miscellaneous"
}

export function normalizeDescription(raw: string): string {
  return raw
    .replace(/\b(UPI|NEFT|IMPS|RTGS|VPA|REF|TXN|TRN|POS|ATM|BRN|CR|DR)\b/gi, "")
    .replace(/\d{6,}/g, "")           // remove long reference numbers
    .replace(/[*\/\\|<>@]/g, " ")     // remove special chars
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, "")  // trim leading/trailing dashes
    .replace(/\b\w/g, (c) => c.toUpperCase()) // title case
    .slice(0, 80)
}

export function makeHash(userId: string, date: string, amount: number, rawDesc: string): string {
  return crypto
    .createHash("sha1")
    .update(`${userId}|${date}|${amount}|${rawDesc.toLowerCase().trim()}`)
    .digest("hex")
}

// Batch categorize via Claude for uncategorized descriptions
export async function batchCategorizeWithAI(
  descriptions: string[]
): Promise<Record<string, Category>> {
  if (!process.env.ANTHROPIC_API_KEY || descriptions.length === 0) return {}

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `Categorize each transaction description into exactly one of these categories:
${CATEGORIES.join(", ")}

Descriptions (one per line):
${descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Respond with ONLY a JSON array of objects like:
[{"index": 1, "category": "Food / Dining"}, ...]

Rules:
- If it looks like income/salary, use "Salary / Income"
- UPI transfers between individuals = "Transfers"
- Insurance premiums = "EMI / Loans"
- Grocery stores = "Shopping"
- When unsure, use "Miscellaneous"`

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    })
    const text = (msg.content[0] as { text: string }).text
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return {}
    const results = JSON.parse(jsonMatch[0]) as { index: number; category: string }[]
    const map: Record<string, Category> = {}
    for (const r of results) {
      const desc = descriptions[r.index - 1]
      if (desc && CATEGORIES.includes(r.category as Category)) {
        map[desc] = r.category as Category
      }
    }
    return map
  } catch {
    return {}
  }
}
