import crypto from "crypto"
import { GoogleGenerativeAI } from "@google/generative-ai"

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

// Keyword rules — handles ~85% of Indian transactions, zero API calls
const RULES: Record<Category, string[]> = {
  "Salary / Income": [
    "salary", "payroll", "credited by", "neft cr", "imps cr", "upi cr",
    "bonus", "incentive", "reimbursement", "refund", "cashback", "stipend",
  ],
  "Food / Dining": [
    "zomato", "swiggy", "dominos", "domino", "pizza hut", "kfc", "mcdonalds",
    "mcdonald", "burger king", "subway", "starbucks", "cafe coffee day", "ccd",
    "dunkin", "haldiram", "barbeque", "bbq", "chaayos", "chai point",
    "restaurant", "dining", "food", "biryani", "kitchen", "dhaba", "bakery",
    "canteen", "eatery", "mess", "tiffin",
  ],
  "Transport": [
    "ola", "uber", "rapido", "metro", "irctc", "indigo", "spicejet",
    "air india", "airindia", "goindigo", "vistara", "akasa", "makemytrip",
    "yatra", "petrol", "fuel", "iocl", "bpcl", "hpcl", "parking",
    "fastag", "toll", "cab", "taxi", "auto", "rickshaw", "redbus",
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
    "property tax",
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
    "equated monthly", "bajaj finance", "insurance premium", "lic ",
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
    .replace(/\d{6,}/g, "")
    .replace(/[*\/\\|<>@]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 80)
}

export function makeHash(userId: string, date: string, amount: number, rawDesc: string): string {
  return crypto
    .createHash("sha1")
    .update(`${userId}|${date}|${amount}|${rawDesc.toLowerCase().trim()}`)
    .digest("hex")
}

// In-memory cache: merchant → category (avoids repeat API calls for same merchant)
const categoryCache = new Map<string, Category>()

/**
 * Batch categorize via Gemini — optimized for quota:
 * 1. Deduplicate descriptions (50 Zomato orders = 1 API lookup)
 * 2. Only send truly uncategorized items
 * 3. Single API call for entire batch
 * 4. Results cached in-memory for process lifetime
 */
export async function batchCategorizeWithAI(
  descriptions: string[]
): Promise<Record<string, Category>> {
  if (!process.env.GEMINI_API_KEY || descriptions.length === 0) return {}

  // Deduplicate — same merchant appears many times, only categorize once
  const unique = [...new Set(descriptions)].filter((d) => !categoryCache.has(d))

  if (unique.length === 0) {
    // All already cached
    const result: Record<string, Category> = {}
    for (const d of descriptions) {
      const cached = categoryCache.get(d)
      if (cached) result[d] = cached
    }
    return result
  }

  // Cap at 40 unique items per call to stay well within token limits
  const batch = unique.slice(0, 40)

  const prompt = `Categorize each into one of: ${CATEGORIES.join("|")}

${batch.map((d, i) => `${i + 1}.${d}`).join("\n")}

Reply ONLY with JSON array: [{"i":1,"c":"Food / Dining"},...]`

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { maxOutputTokens: 512, temperature: 0 },
    })

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return {}

    const parsed = JSON.parse(jsonMatch[0]) as { i: number; c: string }[]
    const map: Record<string, Category> = {}

    for (const r of parsed) {
      const desc = batch[r.i - 1]
      if (desc && CATEGORIES.includes(r.c as Category)) {
        const cat = r.c as Category
        categoryCache.set(desc, cat)
        map[desc] = cat
      }
    }

    // Also return cached results for the full input list
    for (const d of descriptions) {
      if (!map[d]) {
        const cached = categoryCache.get(d)
        if (cached) map[d] = cached
      }
    }

    return map
  } catch (err) {
    console.error("Gemini categorize error:", err)
    return {}
  }
}
