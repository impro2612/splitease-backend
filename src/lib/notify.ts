import { sendPushNotification } from "@/lib/push"

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
  const uniqueTokens = new Set<string>()

  await Promise.all(
    users.map(async (user) => {
      if (excluded.has(user.id)) return
      const tokens = user.pushDevices?.map((device) => device.token).filter(Boolean) ?? []
      await Promise.all(
        tokens.map(async (token) => {
          if (uniqueTokens.has(token)) return
          uniqueTokens.add(token)
          await sendPushNotification(token, title, body, data)
        })
      )
    })
  )
}
