import { test } from "node:test"
import assert from "node:assert/strict"
import { buildBalanceMap, clampSettlementCents, getNetPerPerson } from "./balance.ts"
import { rescaleSplits } from "./splits.ts"
import { classifyRefreshUse, deriveSuccessorToken, hashToken } from "./token-utils.ts"
import { checkRateLimits, inMemoryRateLimit, inMemoryStoreSize } from "./rate-limit.ts"
import { scrubActivityMeta } from "./activity-scrub.ts"
import { decideWebhookFallback } from "./plus-webhook.ts"

// ---- settle clamping ----
test("settlement is clamped to what is owed", () => {
  assert.equal(clampSettlementCents(1000, 2500), 1000) // over-pay
  assert.equal(clampSettlementCents(1000, 1000), 1000) // exact
  assert.equal(clampSettlementCents(1000, 250), 250)   // partial
  assert.equal(clampSettlementCents(1000, 0), 0)       // zero
  assert.equal(clampSettlementCents(0, 500), 0)        // nothing owed
  assert.equal(clampSettlementCents(1000, -5), 0)      // negative never recorded
  assert.equal(clampSettlementCents(1000, NaN), 0)
})

// ---- proportional rescale ----
const rows = (shares: Record<string, number>) => Object.entries(shares).map(([userId, amount]) => ({ userId, amount }))

test("rescale keeps the sum exact and hands the remainder out one cent at a time", () => {
  const out = rescaleSplits(rows({ A: 100, B: 100, C: 100 }), 300, 1000, "A")
  assert.equal(out.reduce((s, r) => s + r.amount, 0), 1000)
  // 333 each, remainder 1 → first row gets it
  assert.deepEqual(out.map((r) => r.amount), [334, 333, 333])
  assert.deepEqual(out.map((r) => r.paid), [true, false, false])
})

test("rescale preserves unequal proportions", () => {
  const out = rescaleSplits(rows({ A: 150, B: 50 }), 200, 1000, "B")
  assert.deepEqual(out.map((r) => r.amount), [750, 250])
  assert.deepEqual(out.map((r) => r.paid), [false, true])
})

test("rescale works for zero-decimal currencies (whole units) and shrinking amounts", () => {
  // JPY: 1000 → 7, cannot be split evenly
  const out = rescaleSplits(rows({ A: 500, B: 300, C: 200 }), 1000, 7, "C")
  assert.equal(out.reduce((s, r) => s + r.amount, 0), 7)
  assert.deepEqual(out.map((r) => r.amount), [4, 2, 1])
  assert.ok(out.every((r) => Number.isInteger(r.amount) && r.amount >= 0))
})

test("rescale of an empty or zero-total expense yields no splits", () => {
  assert.deepEqual(rescaleSplits([], 100, 200, "A"), [])
  assert.deepEqual(rescaleSplits(rows({ A: 0 }), 0, 200, "A"), [])
})

// ---- multi-currency never mixes ----
test("balances are computed per currency and never mix", () => {
  const exp = (currency: string, paidById: string, shares: Record<string, number>) => ({
    currency, paidById,
    splits: Object.entries(shares).map(([userId, amount]) => ({ userId, amount, paid: userId === paidById })),
  })
  const all = [exp("USD", "A", { A: 100, B: 100 }), exp("INR", "B", { A: 5000, B: 5000 })]
  const byCurrency = new Map<string, typeof all>()
  for (const e of all) byCurrency.set(e.currency, [...(byCurrency.get(e.currency) ?? []), e])

  const usd = getNetPerPerson(byCurrency.get("USD")!, [], true)
  const inr = getNetPerPerson(byCurrency.get("INR")!, [], true)
  assert.equal(usd.get("A"), 100); assert.equal(usd.get("B"), -100)
  assert.equal(inr.get("A"), -5000); assert.equal(inr.get("B"), 5000)

  const usdMap = buildBalanceMap(byCurrency.get("USD")!, [], true)
  assert.equal(usdMap.B.A, 100)
  assert.equal(usdMap.A?.B, undefined) // INR debt from A→B is not in the USD map

  // Mixing them would wrongly net A to -4900 — the grouping must keep them apart
  const mixed = getNetPerPerson(all, [], true)
  assert.notEqual(mixed.get("A"), usd.get("A"))
})

// ---- refresh-token helpers ----
test("refresh token hash and derived successor are deterministic and distinct", () => {
  const secret = new TextEncoder().encode("test-secret")
  const raw = "a".repeat(128)
  assert.equal(hashToken(raw), hashToken(raw))
  assert.equal(deriveSuccessorToken(raw, secret), deriveSuccessorToken(raw, secret))
  assert.notEqual(deriveSuccessorToken(raw, secret), raw)
  assert.notEqual(deriveSuccessorToken(raw, secret), deriveSuccessorToken("b".repeat(128), secret))
  assert.notEqual(deriveSuccessorToken(raw, secret), deriveSuccessorToken(raw, new TextEncoder().encode("other")))
  assert.match(deriveSuccessorToken(raw, secret), /^[0-9a-f]{64}$/)
})

test("replay classification: fresh, retry within grace, theft after grace", () => {
  const now = Date.parse("2026-11-09T10:00:00Z")
  const grace = 60_000
  assert.equal(classifyRefreshUse(null, now, grace), "fresh")
  assert.equal(classifyRefreshUse(new Date(now - 1_000), now, grace), "retry")
  assert.equal(classifyRefreshUse(new Date(now - grace), now, grace), "retry")     // boundary inclusive
  assert.equal(classifyRefreshUse(new Date(now - grace - 1), now, grace), "theft")
})

// ---- in-memory rate limiter (no Redis env in tests) ----
test("in-memory limiter enforces the window and resets after it", () => {
  const key = `t:${Math.random()}`
  const t0 = 1_000_000
  assert.equal(inMemoryRateLimit(key, 3, 10_000, t0), true)
  assert.equal(inMemoryRateLimit(key, 3, 10_000, t0 + 1), true)
  assert.equal(inMemoryRateLimit(key, 3, 10_000, t0 + 2), true)
  assert.equal(inMemoryRateLimit(key, 3, 10_000, t0 + 3), false)     // limit hit
  assert.equal(inMemoryRateLimit(key, 3, 10_000, t0 + 9_999), false) // still inside window
  assert.equal(inMemoryRateLimit(key, 3, 10_000, t0 + 10_000), true) // oldest expired → allowed
})

test("in-memory limiter prunes expired keys when a new key is inserted", () => {
  const t0 = 5_000_000
  const a = `prune-a:${Math.random()}`, b = `prune-b:${Math.random()}`
  inMemoryRateLimit(a, 5, 1_000, t0)
  const sizeWithA = inMemoryStoreSize()
  inMemoryRateLimit(b, 5, 1_000, t0 + 500)       // a still live → not pruned
  assert.equal(inMemoryStoreSize(), sizeWithA + 1)
  inMemoryRateLimit(`prune-c:${Math.random()}`, 5, 1_000, t0 + 2_000) // a and b expired → pruned
  assert.equal(inMemoryStoreSize(), 1)
})

test("checkRateLimits returns one verdict per limit and counts each key on its own", async () => {
  const a = `multi-a:${Math.random()}`, b = `multi-b:${Math.random()}`
  // a allows 1 per window, b allows 3: the second batch must trip a but not b
  const limits = [{ key: a, max: 1, windowMs: 60_000 }, { key: b, max: 3, windowMs: 60_000 }]
  assert.deepEqual(await checkRateLimits(limits), [true, true])
  assert.deepEqual(await checkRateLimits(limits), [false, true])
  assert.deepEqual(await checkRateLimits(limits), [false, true])
  assert.deepEqual(await checkRateLimits(limits), [false, false])
  assert.deepEqual(await checkRateLimits([]), [])
  // the same key listed twice in one batch is counted twice
  const c = `multi-c:${Math.random()}`
  assert.deepEqual(await checkRateLimits([{ key: c, max: 1, windowMs: 60_000 }, { key: c, max: 1, windowMs: 60_000 }]), [true, false])
})

// ---- activity meta scrub ----
test("scrubActivityMeta replaces the deleted user's names and nothing else", () => {
  const meta = JSON.stringify({ toUserName: "Alice", recordedBy: "Bob", groupName: "Alice's trip", amount: 5 })
  const out = JSON.parse(scrubActivityMeta(meta, "Alice", false)!)
  assert.equal(out.toUserName, "Deleted user")
  assert.equal(out.recordedBy, "Bob")
  assert.equal(out.groupName, "Alice's trip") // group names are not personal names
  assert.equal(out.amount, 5)
  assert.equal(scrubActivityMeta(meta, "Carol", false), null) // untouched → null
  assert.equal(scrubActivityMeta("not json", "Alice", false), null)
})

test("scrubActivityMeta trusts targetUserId over a stale captured name", () => {
  const meta = JSON.stringify({ toUserName: "Old Name", oldPaidByName: "Alice", newPaidByName: "Bob" })
  const out = JSON.parse(scrubActivityMeta(meta, "Alice", true)!)
  assert.equal(out.toUserName, "Deleted user")
  assert.equal(out.oldPaidByName, "Deleted user")
  assert.equal(out.newPaidByName, "Bob")
})

// ---- RevenueCat webhook fallback ----
test("webhook: lookup failed and event lacks expiration → retry (when lookup is configured)", () => {
  assert.deepEqual(decideWebhookFallback(undefined, { type: "RENEWAL" }, true), { action: "retry" })
  assert.deepEqual(decideWebhookFallback(undefined, { type: "TEST" }, false), { action: "ignore" })
  assert.deepEqual(decideWebhookFallback(null, { type: "EXPIRATION" }, true), { action: "synced" })
  assert.deepEqual(decideWebhookFallback(new Date(), {}, true), { action: "synced" })
  const d = decideWebhookFallback(undefined, { type: "CANCELLATION", expiration_at_ms: 1_800_000_000_000 }, true)
  assert.equal(d.action, "apply")
  if (d.action === "apply") {
    assert.equal(d.until.getTime(), 1_800_000_000_000)
    assert.equal(d.willRenew, false)
  }
  const r = decideWebhookFallback(undefined, { type: "RENEWAL", expiration_at_ms: 1 }, false)
  assert.equal(r.action === "apply" && r.willRenew, true)
  const u = decideWebhookFallback(undefined, { type: "BILLING_ISSUE", expiration_at_ms: 1 }, true)
  assert.equal(u.action === "apply" && u.willRenew, undefined)
})
