import { prisma } from "@/lib/prisma"

// Never cached: a monitor hitting this must see the database as it is right now
export const dynamic = "force-dynamic"

// GET /api/health — liveness + a DB round trip, for uptime monitors
export async function GET() {
  const time = new Date().toISOString()
  try {
    await prisma.$queryRaw`SELECT 1`
    return Response.json({ ok: true, db: "ok", time })
  } catch (err) {
    console.error("[health] database check failed:", err instanceof Error ? err.message : err)
    return Response.json({ ok: false, db: "error", time }, { status: 503 })
  }
}
