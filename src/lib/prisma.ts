import { PrismaClient } from "@/generated/prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

if (process.env.NODE_ENV === "production") {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in production")
  if (!process.env.TURSO_AUTH_TOKEN) throw new Error("TURSO_AUTH_TOKEN is required in production")
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const adapter = new PrismaLibSql({
    url: (process.env.DATABASE_URL ?? "file:./dev.db").trim(),
    authToken: process.env.TURSO_AUTH_TOKEN?.trim(),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any)
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
