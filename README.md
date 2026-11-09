# SplitEase Backend
# SplitEase Backend

## Database migrations

> **Naming drift (checked 9 Nov 2026):** the production database was built by hand before
> `prisma/migrations` existed, so some indexes carry different names from the ones in
> `0_init` (`idx_ptxn_user_date` vs `PersonalTransaction_userId_date_idx`, `Message_convo_idx`,
> `ExpenseReaction_unique`, `Block_*_idx`), and unique keys live as inline `UNIQUE` constraints
> (`sqlite_autoindex_*`) rather than named unique indexes. Columns and constraints match the
> schema; only the names differ. Don't "fix" this by re-running `0_init` against production.

The schema lives in `prisma/schema.prisma`; `prisma/migrations/` is the history of SQL
applied to Turso, starting from `0_init` (a baseline generated from the schema as it was
when migrations were introduced — the production database already matched it, so it is
never applied there). Prisma never talks to the production database directly (no
`prisma migrate dev` / `db push` against Turso): migrations are generated as SQL, reviewed,
and applied by hand.

1. Edit `prisma/schema.prisma`, then generate the SQL for the delta since the last migration:

   ```sh
   mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_<name>
   npx prisma migrate diff \
     --from-migrations prisma/migrations \
     --to-schema prisma/schema.prisma \
     --script > prisma/migrations/<timestamp>_<name>/migration.sql
   ```

   (`--from-migrations` needs a shadow database; on SQLite Prisma creates a temporary one
   itself, nothing to configure.)

2. Read the SQL. SQLite can't alter most column definitions, so Prisma emits
   create-copy-drop-rename table rewrites — make sure data-carrying columns are copied and
   that there's no `DROP TABLE` you didn't intend.

3. Apply it to Turso, either with the Turso CLI:

   ```sh
   turso db shell splitease < prisma/migrations/<timestamp>_<name>/migration.sql
   ```

   or with the bundled script, which reads `DATABASE_URL` + `TURSO_AUTH_TOKEN` from `.env`
   and runs the statements in one transaction (`--dry-run` just lists them):

   ```sh
   node scripts/apply-sql.mjs prisma/migrations/<timestamp>_<name>/migration.sql --dry-run
   node scripts/apply-sql.mjs prisma/migrations/<timestamp>_<name>/migration.sql
   ```

4. Run `npx prisma generate`, commit the migration folder together with the schema change,
   and deploy. Apply the SQL *before* the deploy that needs it goes live — the Vercel build
   doesn't run migrations.

Local development uses `prisma/dev.db`; `npx prisma db push` is fine there.
