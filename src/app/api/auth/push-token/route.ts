import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

// POST /api/auth/push-token  — saves or updates the user's Expo push token
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { pushToken } = await req.json()
  if (!pushToken) return Response.json({ error: "pushToken required" }, { status: 400 })

  await prisma.pushDevice.upsert({
    where: { token: pushToken },
    update: { userId: user.id },
    create: {
      userId: user.id,
      token: pushToken,
    },
  })

  return Response.json({ ok: true })
}

// DELETE /api/auth/push-token  — clears the current device push token
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { pushToken } = await req.json().catch(() => ({ pushToken: undefined }))
  if (!pushToken) return Response.json({ error: "pushToken required" }, { status: 400 })

  await prisma.pushDevice.deleteMany({
    where: {
      userId: user.id,
      token: pushToken,
    },
  })

  return Response.json({ ok: true })
}
