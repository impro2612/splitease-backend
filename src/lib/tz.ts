// Calendar bucketing in the *user's* timezone. The server runs in UTC, so an IST expense
// at 00:30 on 1 Jan would otherwise land in the previous year/month.
//
// `offset` follows JavaScript's getTimezoneOffset() convention: minutes to ADD to local
// time to get UTC (IST = -330, New York winter = +300).

const MIN = 60 * 1000
const MAX_ABS_OFFSET = 14 * 60

type RequestLike = { headers: { get(name: string): string | null }; url: string }

/** Offset from the `x-tz-offset` header, else the `tzOffset` query param; clamped, default 0. */
export function tzOffsetMinutes(req: RequestLike): number {
  const fromHeader = parseOffset(req.headers.get("x-tz-offset"))
  if (fromHeader !== null) return fromHeader
  let fromQuery: string | null = null
  try {
    fromQuery = new URL(req.url).searchParams.get("tzOffset")
  } catch {
    fromQuery = null
  }
  return parseOffset(fromQuery) ?? 0
}

function parseOffset(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.max(-MAX_ABS_OFFSET, Math.min(MAX_ABS_OFFSET, Math.trunc(n)))
}

/** The instant shifted so that its UTC fields read as the user's local wall-clock fields. */
function toLocalWallClock(d: Date, offset: number): Date {
  return new Date(d.getTime() - offset * MIN)
}

export function localYear(d: Date, offset: number): number {
  return toLocalWallClock(d, offset).getUTCFullYear()
}

/** "YYYY-MM" of the instant in the user's timezone. */
export function localMonthKey(d: Date, offset: number): string {
  const l = toLocalWallClock(d, offset)
  return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}`
}

/** "YYYY-MM-DD" of the instant in the user's timezone. */
export function localDayKey(d: Date, offset: number): string {
  return toLocalWallClock(d, offset).toISOString().slice(0, 10)
}

/** UTC instants of the user's local month start (inclusive) and next-month start (exclusive). Month may overflow (0, 13, -2…). */
export function monthRangeUtc(y: number, m: number, offset: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(y, m - 1, 1) + offset * MIN),
    end: new Date(Date.UTC(y, m, 1) + offset * MIN),
  }
}

export function currentMonthFor(offset: number, now = new Date()): { y: number; m: number } {
  const l = toLocalWallClock(now, offset)
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1 }
}
