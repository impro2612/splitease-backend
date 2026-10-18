import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { getPlusStatus } from "@/lib/plus"

// GET /api/plus/status — trial / subscription state for the signed-in user
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  return Response.json(await getPlusStatus(user.id))
}
