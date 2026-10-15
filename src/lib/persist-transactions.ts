import { prisma } from "./prisma"
import type { Prisma } from "@/generated/prisma/client"

type Row = Prisma.PersonalTransactionCreateManyInput

/**
 * Inserts only rows whose dedup hash isn't stored yet, in batched createMany calls
 * (instead of one INSERT per row with a caught unique-violation per duplicate).
 */
export async function insertNewTransactions(rows: Row[]): Promise<{ imported: number; duplicates: number }> {
  const unique = Array.from(new Map(rows.map((r) => [r.hash, r])).values())
  const existing = new Set<string>()
  for (let i = 0; i < unique.length; i += 500) {
    const found = await prisma.personalTransaction.findMany({
      where: { hash: { in: unique.slice(i, i + 500).map((r) => r.hash) } },
      select: { hash: true },
    })
    found.forEach((f) => existing.add(f.hash))
  }
  const fresh = unique.filter((r) => !existing.has(r.hash))
  let imported = 0
  for (let i = 0; i < fresh.length; i += 200) {
    const res = await prisma.personalTransaction.createMany({ data: fresh.slice(i, i + 200) })
    imported += res.count
  }
  return { imported, duplicates: rows.length - imported }
}
