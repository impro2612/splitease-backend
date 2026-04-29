import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const conn = await prisma.gmailConnection.findUnique({ where: { userId: user.id } })
  if (!conn) return Response.json({ connected: false })

  return Response.json({
    connected: true,
    email: conn.email,
    lastSyncAt: conn.lastSyncAt,
  })
}
