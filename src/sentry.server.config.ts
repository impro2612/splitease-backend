import * as Sentry from "@sentry/nextjs"

// Shared by the nodejs and edge runtimes; a no-op until SENTRY_DSN is set
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.05,
  // v11 dropped sendDefaultPii; opt out of every PII category explicitly
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
})
