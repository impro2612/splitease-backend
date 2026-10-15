import { prisma } from "./prisma"

export const pairKey = (a: string, b: string) => [a, b].sort().join("|")

/** Set of pairKey()s for every block (either direction) between `userId` and `others`. */
export async function blockedPairs(userId: string, others: string[]): Promise<Set<string>> {
  if (others.length === 0) return new Set()
  const blocks = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: others } },
        { blockerId: { in: others }, blockedId: userId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  })
  return new Set(blocks.map((b) => pairKey(b.blockerId, b.blockedId)))
}
