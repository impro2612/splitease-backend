/**
 * What a RevenueCat webhook should do after the subscriber lookup, kept pure for tests.
 *  - "synced": the REST lookup stored the truth; nothing more to do.
 *  - "apply":  lookup unavailable but the event carries an expiry → store it directly.
 *  - "retry":  lookup configured but failed, and the event has no expiry → answer non-2xx
 *              so RevenueCat redelivers later instead of the event being silently dropped.
 *  - "ignore": lookup not configured and nothing to store; retrying could never help.
 */
export type WebhookEvent = { type?: unknown; expiration_at_ms?: unknown }

export type WebhookDecision =
  | { action: "synced" }
  | { action: "apply"; until: Date; willRenew: boolean | undefined }
  | { action: "retry" }
  | { action: "ignore" }

const RENEWING_TYPES = ["RENEWAL", "UNCANCELLATION", "INITIAL_PURCHASE", "PRODUCT_CHANGE"]

export function decideWebhookFallback(synced: Date | null | undefined, event: WebhookEvent, lookupConfigured: boolean): WebhookDecision {
  if (synced !== undefined) return { action: "synced" }
  if (typeof event.expiration_at_ms !== "number" || !Number.isFinite(event.expiration_at_ms)) {
    return { action: lookupConfigured ? "retry" : "ignore" }
  }
  const willRenew = event.type === "CANCELLATION" ? false
    : RENEWING_TYPES.includes(String(event.type)) ? true : undefined
  return { action: "apply", until: new Date(event.expiration_at_ms), willRenew }
}
