import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./client";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/** A fresh in-process Postgres with every migration applied. Tests only. */
export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };
}
