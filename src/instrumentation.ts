import * as Sentry from "@sentry/nextjs"

export async function register() {
  // Both runtimes get the same tiny config
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.server.config")
  }
}

// Unhandled errors in route handlers, server components and proxy
export const onRequestError = Sentry.captureRequestError
