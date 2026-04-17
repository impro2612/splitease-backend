/**
 * One-time migration: convert all monetary Float columns to integer cents (Int).
 *
 * Run ONCE against the live Turso DB BEFORE deploying the updated Prisma schema
 * (which changes Float → Int for Expense.amount, ExpenseSplit.amount, Settlement.amount).
 *
 * Usage:
 *   DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/migrate-to-cents.ts
 *
 * SQLite/libSQL does not support ALTER TABLE RENAME COLUMN or DROP COLUMN atomically,
 * so we use the recommended table-rebuild approach.
 */

import { createClient } from "@libsql/client"

async function main() {
  const url = process.env.DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    throw new Error("DATABASE_URL and TURSO_AUTH_TOKEN must be set")
  }

  const db = createClient({ url, authToken })

  console.log("Starting monetary column migration Float → Int (cents)…")

  // ── Expense.amount ────────────────────────────────────────────────────────
  console.log("  Migrating Expense.amount…")
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _Expense_new (
      id          TEXT    PRIMARY KEY,
      groupId     TEXT    NOT NULL,
      description TEXT    NOT NULL,
      amount      INTEGER NOT NULL,
      currency    TEXT    NOT NULL DEFAULT 'USD',
      splitType   TEXT    NOT NULL DEFAULT 'EQUAL',
      paidById    TEXT    NOT NULL,
      createdById TEXT    NOT NULL,
      date        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      category    TEXT    NOT NULL DEFAULT 'general'
    )
  `)
  await db.execute(`
    INSERT INTO _Expense_new
      SELECT id, groupId, description,
             CAST(ROUND(amount * 100) AS INTEGER),
             currency, splitType, paidById, createdById,
             date, createdAt, updatedAt, category
      FROM Expense
  `)
  await db.execute(`DROP TABLE Expense`)
  await db.execute(`ALTER TABLE _Expense_new RENAME TO Expense`)
  console.log("  ✓ Expense.amount migrated")

  // ── ExpenseSplit.amount ───────────────────────────────────────────────────
  console.log("  Migrating ExpenseSplit.amount…")
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _ExpenseSplit_new (
      id        TEXT    PRIMARY KEY,
      expenseId TEXT    NOT NULL,
      userId    TEXT    NOT NULL,
      amount    INTEGER NOT NULL,
      paid      INTEGER NOT NULL DEFAULT 0,
      UNIQUE(expenseId, userId)
    )
  `)
  await db.execute(`
    INSERT INTO _ExpenseSplit_new
      SELECT id, expenseId, userId,
             CAST(ROUND(amount * 100) AS INTEGER),
             paid
      FROM ExpenseSplit
  `)
  await db.execute(`DROP TABLE ExpenseSplit`)
  await db.execute(`ALTER TABLE _ExpenseSplit_new RENAME TO ExpenseSplit`)
  console.log("  ✓ ExpenseSplit.amount migrated")

  // ── Settlement.amount ─────────────────────────────────────────────────────
  console.log("  Migrating Settlement.amount…")
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _Settlement_new (
      id         TEXT     PRIMARY KEY,
      groupId    TEXT     NOT NULL,
      fromUserId TEXT     NOT NULL,
      toUserId   TEXT     NOT NULL,
      amount     INTEGER  NOT NULL,
      note       TEXT,
      createdAt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await db.execute(`
    INSERT INTO _Settlement_new
      SELECT id, groupId, fromUserId, toUserId,
             CAST(ROUND(amount * 100) AS INTEGER),
             note, createdAt
      FROM Settlement
  `)
  await db.execute(`DROP TABLE Settlement`)
  await db.execute(`ALTER TABLE _Settlement_new RENAME TO Settlement`)
  console.log("  ✓ Settlement.amount migrated")

  console.log("Migration complete. Now update prisma schema Float → Int and run `prisma generate`.")
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
