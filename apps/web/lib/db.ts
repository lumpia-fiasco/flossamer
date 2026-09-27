import { pgDb, type Db } from "@flossamer/db";
import { required } from "@/lib/env";

/** The app's database: Neon via its pooled connection string. Server-only. */
export function db(): Db {
  return pgDb(required("DATABASE_URL"));
}
