// Apply pending migrations in order: npm run migrate -w @flossamer/db (reads DATABASE_URL).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (Neon: use the direct, non-pooled connection string for migrations).");

const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    await client.query("begin");
    try {
      await client.query(readFileSync(dir + file, "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  console.log("migrations up to date");
} finally {
  await client.end();
}
