// Expo Push Notification helper — no SDK needed, just HTTP
export async function sendPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (!pushToken || !pushToken.startsWith("ExponentPushToken")) return

  await fetch("https://exp.host/--/api/v2/push/send", {
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
  }).catch(() => {}) // fire-and-forget
}
