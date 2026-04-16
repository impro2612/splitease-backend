import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// POST /api/auth/push-token  — saves or updates the user's Expo push token
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { pushToken } = await req.json()
  if (!pushToken) return Response.json({ error: "pushToken required" }, { status: 400 })

  await prisma.user.update({
    where: { id: user.id },
    data: { pushToken },
  })

  return Response.json({ ok: true })
}
