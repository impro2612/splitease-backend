/**
 * Schema changes for the Oct 2026 production-readiness audit. Idempotent.
 *
 *   node scripts/migrate-audit-2026-10.mjs pre    # BEFORE deploying the new API (additive only)
 *   node scripts/migrate-audit-2026-10.mjs post   # AFTER the new API is live
 *
 * Needs DATABASE_URL + TURSO_AUTH_TOKEN. "post" drops things the previous API version still
 * used (global Message.clientId uniqueness, the never-used Invitation table), so it must only
 * run once the new deployment is serving traffic.
 */
import { createClient } from "@libsql/client"

const phase = process.argv[2]
if (phase !== "pre" && phase !== "post") throw new Error("usage: migrate-audit-2026-10.mjs pre|post")

const db = createClient({ url: process.env.DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN.trim() })
const cols = async (t) => (await db.execute(`PRAGMA table_info("${t}")`)).rows.map((r) => r.name)
const run = async (sql) => { console.log("  " + sql); await db.execute(sql) }

if (phase === "pre") {
  if (!(await cols("PasswordReset")).includes("attempts"))
    await run(`ALTER TABLE "PasswordReset" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0`)
  await run(`CREATE INDEX IF NOT EXISTS "PasswordReset_email_idx" ON "PasswordReset"("email")`)

  if (!(await cols("Expense")).includes("clientRequestId"))
    await run(`ALTER TABLE "Expense" ADD COLUMN "clientRequestId" TEXT`)
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS "Expense_clientRequestId_key" ON "Expense"("clientRequestId")`)

  await run(`CREATE UNIQUE INDEX IF NOT EXISTS "Message_senderId_clientId_key" ON "Message"("senderId", "clientId")`)

  // Emails are canonical lowercase from now on; abort rather than merge if two rows collide
  const collisions = (await db.execute(
    `SELECT lower(trim(email)) e FROM "User" GROUP BY 1 HAVING COUNT(*) > 1`
  )).rows
  if (collisions.length) throw new Error(`Case-insensitive email collisions need manual review: ${JSON.stringify(collisions)}`)
  await run(`UPDATE "User" SET email = lower(trim(email)) WHERE email != lower(trim(email))`)
  await run(`UPDATE "PasswordReset" SET email = lower(trim(email)) WHERE email != lower(trim(email))`)
} else {
  await run(`DROP INDEX IF EXISTS "Message_clientId_key"`)
  const invites = (await db.execute(`SELECT COUNT(*) c FROM "Invitation"`).catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c
  if (Number(invites) > 0) throw new Error(`Invitation has ${invites} rows — not dropping`)
  await run(`DROP TABLE IF EXISTS "Invitation"`)
}
console.log(`${phase} migration complete`)
