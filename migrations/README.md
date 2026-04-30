# Migrations

SQL migrations shared by:

- the Tauri backend (`apps/desktop/src-tauri/src/migrations.rs` registers them with
  `tauri-plugin-sql`),
- the `@kana-typing/content-cli` Node CLI (used in dev mode to seed a local SQLite file).

Rules:

- Files are named `NNN_<topic>.sql` and applied in lexicographic order.
- Migrations must be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- Never edit a published migration. Add a new file with a higher number instead.
- The `kana_typing` SQLite file is gitignored; only the migration SQL is checked in.
