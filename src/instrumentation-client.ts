import * as Sentry from "@sentry/nextjs"

// The browser only serves the privacy/terms pages, so keep this minimal.
// NEXT_PUBLIC_* is inlined at build time: unset there = disabled in the bundle.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  // v11 dropped sendDefaultPii; opt out of every PII category explicitly
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
