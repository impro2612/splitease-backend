import { prisma } from "@/lib/prisma"

// Expo Push Notification helper — no SDK needed, just HTTP
export async function sendPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (!pushToken || !pushToken.startsWith("ExponentPushToken")) return

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "accept-encoding": "gzip, deflate",
      },
      body: JSON.stringify({
        to: pushToken,
        sound: "default",
        title,
        body,
        data: data ?? {},
      }),
    })
    const json = await res.json()
    // Expo returns DeviceNotRegistered when the token is stale — clean it up
    if (json?.data?.details?.error === "DeviceNotRegistered") {
      await prisma.pushDevice.deleteMany({ where: { token: pushToken } }).catch(() => {})
    }
  } catch {
    // fire-and-forget
  }
}
