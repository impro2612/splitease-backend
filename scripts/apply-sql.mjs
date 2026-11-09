// Applies a .sql file (e.g. a Prisma migration) to the Turso database in .env, statement
// by statement inside one transaction, so a half-applied migration can't be left behind.
//
//   node scripts/apply-sql.mjs prisma/migrations/<timestamp>_<name>/migration.sql [--dry-run]
//
// Reads DATABASE_URL + TURSO_AUTH_TOKEN from .env. A file: URL works too (local dev.db).
import "dotenv/config"
import { readFileSync } from "node:fs"
import { createClient } from "@libsql/client"

const [file, ...flags] = process.argv.slice(2)
if (!file) {
  console.error("usage: node scripts/apply-sql.mjs <file.sql> [--dry-run]")
  process.exit(2)
}
const dryRun = flags.includes("--dry-run")

const url = process.env.DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.trim()
if (!url) {
  console.error("DATABASE_URL is not set (put it in .env)")
  process.exit(2)
}

// Prisma's generated SQL is one statement per `;` at end of line; comments are dropped.
// Good enough for DDL — don't feed it data with literal ";\n" inside strings.
const statements = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean)

if (statements.length === 0) {
  console.error(`${file}: no statements found`)
  process.exit(2)
}

console.log(`${file}: ${statements.length} statement(s) → ${url.replace(/\?.*$/, "")}${dryRun ? " (dry run)" : ""}`)
for (const s of statements) console.log("  " + s.split("\n")[0].slice(0, 100) + (s.includes("\n") || s.length > 100 ? " …" : ""))
if (dryRun) process.exit(0)

const client = createClient({ url, authToken })
try {
  await client.batch(statements, "write") // all-or-nothing
  console.log("applied")
} catch (err) {
  console.error("failed, nothing applied:", err instanceof Error ? err.message : err)
  process.exit(1)
} finally {
  client.close()
}
