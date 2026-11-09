import * as Sentry from "@sentry/nextjs"

/**
 * Reports a caught error that would otherwise be swallowed. Always logs so Vercel
 * logs show it even before Sentry exists; captureException is a no-op without a DSN.
 */
export function captureError(err: unknown, context?: Record<string, unknown>) {
  try {
    console.error("[monitoring]", context?.where ?? "", err)
    Sentry.captureException(err, context ? { extra: context } : undefined)
  } catch {
    // Monitoring must never fail the request that called it
  }
}
