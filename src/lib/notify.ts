import { sendPushMessages } from "@/lib/push"

type PushUser = {
  id: string
  name?: string | null
  email?: string | null
  pushDevices?: Array<{ token: string }>
}

export function getDisplayName(user: Pick<PushUser, "name" | "email" | "id">): string {
  return user.name?.trim() || user.email?.trim() || "Someone"
}

export function buildAppUrl(
  path: string,
  params?: Record<string, string | number | undefined>
): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) qs.set(key, String(value))
  }
  const query = qs.toString()
  return `splitit://${path}${query ? `?${query}` : ""}`
}

export async function notifyUsers(
  users: PushUser[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
  excludeUserIds: string[] = []
) {
  const excluded = new Set(excludeUserIds)
  // Dedupe first so a token shared by two users gets one push, then send everything
  // in a single batched call instead of one HTTPS round-trip per device
  const tokens = new Set<string>()
  for (const user of users) {
    if (excluded.has(user.id)) continue
    for (const device of user.pushDevices ?? []) if (device.token) tokens.add(device.token)
  }
  if (!tokens.size) return
  await sendPushMessages([...tokens].map((to) => ({ to, title, body, data })))
}
