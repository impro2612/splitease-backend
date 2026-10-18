import { prisma } from "@/lib/prisma"
import { plusStatus, type PlusStatus } from "./plus-status"

export { TRIAL_DAYS, trialEnd, plusStatus, type PlusStatus } from "./plus-status"

export async function getPlusStatus(userId: string): Promise<PlusStatus> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, trialEndsAt: true, plusUntil: true },
  })
  if (!u) return { access: false, plan: "free", trialEndsAt: null, plusUntil: null, daysLeft: 0 }
  return plusStatus(u)
}

// Route guard: returns a 402 response when the user has no Plus access, else null.
export async function requirePlus(userId: string): Promise<Response | null> {
  const s = await getPlusStatus(userId)
  if (s.access) return null
  return Response.json(
    { error: "This feature needs SplitIT Plus", code: "PLUS_REQUIRED" },
    { status: 402 },
  )
}
