import { test } from "node:test"
import assert from "node:assert/strict"
import { currentMonthFor, localDayKey, localMonthKey, localYear, monthRangeUtc, tzOffsetMinutes } from "./tz.ts"

const IST = -330

const req = (header: string | null, query = "") => ({
  headers: { get: (name: string) => (name === "x-tz-offset" ? header : null) },
  url: `https://example.com/api/x${query}`,
})

test("IST: 19:00Z on 31 Dec is already 1 Jan of the next year locally", () => {
  const d = new Date("2025-12-31T19:00:00Z")
  assert.equal(localYear(d, IST), 2026)
  assert.equal(localMonthKey(d, IST), "2026-01")
  assert.equal(localDayKey(d, IST), "2026-01-01")
  // Same instant in UTC and in a western zone stays in 2025
  assert.equal(localYear(d, 0), 2025)
  assert.equal(localYear(d, 300), 2025)
})

test("monthRangeUtc gives the UTC instants of the local month boundaries", () => {
  const { start, end } = monthRangeUtc(2026, 1, IST)
  assert.equal(start.toISOString(), "2025-12-31T18:30:00.000Z")
  assert.equal(end.toISOString(), "2026-01-31T18:30:00.000Z")
  // Month overflow normalises (used for trend/previous-month windows)
  assert.equal(monthRangeUtc(2026, 0, 0).start.toISOString(), "2025-12-01T00:00:00.000Z")
  assert.equal(monthRangeUtc(2026, 13, 0).start.toISOString(), "2027-01-01T00:00:00.000Z")
  // An instant just inside the local month is inside the range
  const d = new Date("2025-12-31T19:00:00Z")
  assert.ok(d >= start && d < end)
})

test("currentMonthFor follows the local calendar", () => {
  assert.deepEqual(currentMonthFor(IST, new Date("2025-12-31T19:00:00Z")), { y: 2026, m: 1 })
  assert.deepEqual(currentMonthFor(0, new Date("2025-12-31T19:00:00Z")), { y: 2025, m: 12 })
})

test("tzOffsetMinutes: header first, then query, clamped, default 0", () => {
  assert.equal(tzOffsetMinutes(req("-330")), -330)
  assert.equal(tzOffsetMinutes(req(null, "?tzOffset=300")), 300)
  assert.equal(tzOffsetMinutes(req("-330", "?tzOffset=300")), -330)
  assert.equal(tzOffsetMinutes(req("99999")), 840)
  assert.equal(tzOffsetMinutes(req("-99999")), -840)
  assert.equal(tzOffsetMinutes(req("abc")), 0)
  assert.equal(tzOffsetMinutes(req(null)), 0)
  assert.equal(tzOffsetMinutes(req("-330.7")), -330)
})
