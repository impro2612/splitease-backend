import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { pusherServer } from "@/lib/pusher"

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const contentType = req.headers.get("content-type") ?? ""
  let socketId = ""
  let channelName = ""

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null)
    socketId = body?.socket_id ?? ""
    channelName = body?.channel_name ?? ""
  } else {
    const form = await req.formData().catch(() => null)
    socketId = String(form?.get("socket_id") ?? "")
    channelName = String(form?.get("channel_name") ?? "")
  }

  const expectedChannel = `private-user-${user.id}`
  if (!socketId || !channelName) {
    return Response.json({ error: "socket_id and channel_name are required" }, { status: 400 })
  }
  if (channelName !== expectedChannel) {
    return Response.json({ error: "Forbidden channel" }, { status: 403 })
  }

  const auth = pusherServer.authorizeChannel(socketId, channelName)
  return Response.json(auth)
}
