import { test } from "node:test"
import assert from "node:assert/strict"
import { plusStatus, trialEnd } from "./plus-status.ts"

const DAY = 24 * 60 * 60 * 1000
const launch = new Date("2026-11-01T00:00:00Z")
const user = (o: Partial<{ createdAt: Date; trialEndsAt: Date | null; plusUntil: Date | null }> = {}) =>
  ({ createdAt: new Date("2026-01-01T00:00:00Z"), trialEndsAt: null, plusUntil: null, ...o })

test("no launch date: everyone has access", () => {
  const s = plusStatus(user(), new Date("2030-01-01"), null)
  assert.equal(s.access, true)
  assert.equal(s.trialEndsAt, null)
})

test("accounts created before launch get 90 days from launch", () => {
  assert.equal(trialEnd(user(), launch)!.getTime(), launch.getTime() + 90 * DAY)
})

test("accounts created after launch get 90 days from sign-up", () => {
  const created = new Date("2026-12-10T00:00:00Z")
  assert.equal(trialEnd(user({ createdAt: created }), launch)!.getTime(), created.getTime() + 90 * DAY)
})

test("trial active, then locked after it ends", () => {
  const during = plusStatus(user(), new Date(launch.getTime() + 80 * DAY), launch)
  assert.deepEqual([during.access, during.plan, during.daysLeft], [true, "trial", 10])
  const after = plusStatus(user(), new Date(launch.getTime() + 91 * DAY), launch)
  assert.deepEqual([after.access, after.plan], [false, "free"])
})

test("active subscription unlocks, expired one does not", () => {
  const now = new Date(launch.getTime() + 200 * DAY)
  assert.equal(plusStatus(user({ plusUntil: new Date(now.getTime() + DAY) }), now, launch).plan, "plus")
  assert.equal(plusStatus(user({ plusUntil: new Date(now.getTime() - DAY) }), now, launch).access, false)
})

test("per-user trialEndsAt override works even without a launch date", () => {
  const s = plusStatus(user({ trialEndsAt: new Date("2026-01-02") }), new Date("2026-02-01"), null)
  assert.equal(s.access, false)
})

test("cancelled subscription keeps Plus until it ends and reports willRenew false", () => {
  const now = new Date(launch.getTime() + 200 * DAY)
  const s = plusStatus(user({ plusUntil: new Date(now.getTime() + 5 * DAY), plusWillRenew: false } as any), now, launch)
  assert.deepEqual([s.plan, s.access, s.willRenew], ["plus", true, false])
  assert.equal(plusStatus(user(), now, launch).willRenew, null)
})
