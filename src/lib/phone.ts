export function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""

  const normalized = trimmed.replace(/[^\d+]/g, "").replace(/^00/, "+")
  return normalized
}
