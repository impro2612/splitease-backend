/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv").config({ path: ".env" })

const { createClient } = require("@libsql/client")

function normalizePhone(raw) {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return ""
  return trimmed.replace(/[^\d+]/g, "").replace(/^00/, "+")
}

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

async function main() {
  const columns = await client.execute(`PRAGMA table_info("User")`)
  const hasPhoneNormalized = columns.rows.some((row) => String(row.name) === "phoneNormalized")

  if (!hasPhoneNormalized) {
    await client.execute(`ALTER TABLE "User" ADD COLUMN "phoneNormalized" TEXT`)
  }

  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_phoneNormalized_key" ON "User"("phoneNormalized")`
  )

  const users = await client.execute(
    `SELECT id, phone FROM "User" WHERE phone IS NOT NULL AND TRIM(phone) <> ''`
  )

  const seen = new Map()
  let updated = 0

  for (const row of users.rows) {
    const normalized = normalizePhone(row.phone)
    if (!normalized) continue

    const existing = seen.get(normalized)
    if (existing && existing !== String(row.id)) {
      throw new Error(`Duplicate normalized phone detected for ${normalized}: ${existing} and ${row.id}`)
    }
    seen.set(normalized, String(row.id))

    await client.execute({
      sql: `UPDATE "User" SET "phoneNormalized" = ? WHERE "id" = ?`,
      args: [normalized, String(row.id)],
    })
    updated += 1
  }

  console.log(JSON.stringify({ updated }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
