/** Parses "YYYY-MM"; returns null for anything else (including month 13, year 0, etc.). */
export function parseMonth(value: string | null | undefined): { y: number; m: number } | null {
  const match = value?.trim().match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return null
  return { y, m }
}

export function currentMonth(): { y: number; m: number } {
  const now = new Date()
  return { y: now.getFullYear(), m: now.getMonth() + 1 }
}

export const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`
