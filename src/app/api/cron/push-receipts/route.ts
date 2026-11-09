import { NextRequest } from "next/server"
import { timingSafeEqual } from "crypto"
import { processPushReceipts } from "@/lib/push-receipts"

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get("authorization") ?? ""), b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

// GET /api/cron/push-receipts — manual trigger; the daily cleanup cron also runs this
// (the Vercel Hobby plan caps the project at two scheduled cron jobs).
export async function GET(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 })
  return Response.json(await processPushReceipts())
}
