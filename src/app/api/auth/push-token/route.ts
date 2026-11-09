import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { readJson } from "@/lib/request"

const EXPO_PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/

// POST /api/auth/push-token  — saves or updates the user's Expo push token
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { pushToken } = await readJson<{ pushToken: string }>(req)
  if (typeof pushToken !== "string" || !EXPO_PUSH_TOKEN_RE.test(pushToken)) {
    return Response.json({ error: "A valid Expo push token is required" }, { status: 400 })
  }

  // A token belongs to one device. If another account registered it (shared phone, or an
  // account switch where sign-out never reached us), drop that row rather than silently
  // re-pointing it, so a stale binding can never keep delivering someone else's alerts.
  const own = await prisma.pushDevice.updateMany({
    where: { token: pushToken, userId: user.id },
    data: { updatedAt: new Date() },
  })
  if (own.count === 0) {
    await prisma.pushDevice.deleteMany({ where: { token: pushToken } })
    await prisma.pushDevice.create({ data: { userId: user.id, token: pushToken } })
  }

  return Response.json({ ok: true }, { status: 200 })
}

// DELETE /api/auth/push-token  — clears the current device push token
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { pushToken } = await readJson<{ pushToken: string }>(req)
  if (typeof pushToken !== "string" || !pushToken) return Response.json({ error: "pushToken required" }, { status: 400 })

  await prisma.pushDevice.deleteMany({
    where: {
      userId: user.id,
      token: pushToken,
    },
  })

  return Response.json({ ok: true }, { status: 200 })
}
