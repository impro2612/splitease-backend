import { NextRequest } from "next/server"

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
}

/** Parses a JSON body, returning {} for an empty or malformed body instead of throwing. */
export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<Partial<T>> {
  try {
    const body = await req.json()
    return body && typeof body === "object" ? body : {}
  } catch {
    return {}
  }
}

/** Returns a valid Date, null for empty input, or undefined when the value is unparseable. */
export function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const d = new Date(value)
  return isNaN(d.getTime()) ? undefined : d
}

/** A single emoji grapheme (handles ZWJ sequences, skin tones, flags). */
export function isSingleEmoji(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 32) return false
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
  return segments.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value)
}

export const CURRENCY_RE = /^[A-Z]{3}$/

/** Untyped JSON request body — every field is validated by the route before use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonBody = Record<string, any>
