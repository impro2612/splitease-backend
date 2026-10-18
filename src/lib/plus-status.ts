// SplitIT Plus: everyone gets the full app free for TRIAL_DAYS, counted from sign-up
// (or from the Plus launch day for accounts created before it). After that the
// splitting core stays free; the More-section features need an active Plus subscription.
export const TRIAL_DAYS = 90
const DAY = 24 * 60 * 60 * 1000

// Paywall is off until PLUS_LAUNCH_DATE is set — nobody is locked out before launch.
// A per-user trialEndsAt override (used for testing) still applies.
export function launchDate(raw = process.env.PLUS_LAUNCH_DATE): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

export type PlusStatus = {
  access: boolean                 // may use Plus features right now
  plan: "plus" | "trial" | "free"
  trialEndsAt: string | null
  plusUntil: string | null
  daysLeft: number | null         // whole days of trial left (trial only)
}

export type PlusUser = { createdAt: Date; trialEndsAt: Date | null; plusUntil: Date | null }

export function trialEnd(u: PlusUser, launch = launchDate()): Date | null {
  if (u.trialEndsAt) return u.trialEndsAt
  if (!launch) return null
  const start = u.createdAt > launch ? u.createdAt : launch
  return new Date(start.getTime() + TRIAL_DAYS * DAY)
}

export function plusStatus(u: PlusUser, now = new Date(), launch = launchDate()): PlusStatus {
  const end = trialEnd(u, launch)
  const base = { trialEndsAt: end?.toISOString() ?? null, plusUntil: u.plusUntil?.toISOString() ?? null }
  if (u.plusUntil && u.plusUntil > now) return { ...base, access: true, plan: "plus", daysLeft: null }
  if (!end) return { ...base, access: true, plan: "trial", daysLeft: null } // paywall not launched
  if (end > now) return { ...base, access: true, plan: "trial", daysLeft: Math.ceil((end.getTime() - now.getTime()) / DAY) }
  return { ...base, access: false, plan: "free", daysLeft: 0 }
}
