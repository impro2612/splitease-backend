import PusherServer from "pusher"

const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET } = process.env
if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET) {
  throw new Error("PUSHER_APP_ID, PUSHER_KEY and PUSHER_SECRET are required")
}

export const pusherServer = new PusherServer({
  appId: PUSHER_APP_ID,
  key: PUSHER_KEY,
  secret: PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER ?? "ap2",
  useTLS: true,
})
