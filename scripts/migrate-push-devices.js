/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv").config({ path: ".env" })

const { createClient } = require("@libsql/client")

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

async function step(label, sql) {
  await client.execute(sql)
  console.log(label)
}

async function main() {
  await step(
    "created-table",
    `CREATE TABLE IF NOT EXISTS "PushDevice" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "token" TEXT NOT NULL UNIQUE,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`
  )

  await step(
    "created-index",
    `CREATE INDEX IF NOT EXISTS "PushDevice_userId_idx" ON "PushDevice"("userId")`
  )

  await step(
    "created-phone-index",
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User"("phone")`
  )

  const legacy = await client.execute(
    `SELECT id, pushToken FROM "User" WHERE pushToken IS NOT NULL AND TRIM(pushToken) <> ''`
  )

  console.log(`legacy-count:${legacy.rows.length}`)

  for (const row of legacy.rows) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO "PushDevice" ("id", "userId", "token", "createdAt", "updatedAt")
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      args: [`legacy_${String(row.id)}`, String(row.id), String(row.pushToken)],
    })
  }

  const result = await client.execute(
    `SELECT
      (SELECT COUNT(*) FROM "PushDevice") AS push_devices,
      (SELECT COUNT(*) FROM "User" WHERE pushToken IS NOT NULL AND TRIM(pushToken) <> '') AS legacy_tokens`
  )

  console.log(JSON.stringify(result.rows[0], null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
