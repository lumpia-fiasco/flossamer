import pg from "pg";

/**
 * The only thing the repository needs from a database: run one parameterized
 * statement and get rows back. Production uses node-postgres against Neon;
 * tests use PGlite in-process.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

// Keep DATE columns as "YYYY-MM-DD" strings. The default turns them into local-midnight
// Dates, which shift a day west of UTC.
pg.types.setTypeParser(1082, (v) => v);

let pool: pg.Pool | undefined;

/** Pooled connection for serverless: reuse one pool per warm instance. */
export function pgDb(connectionString: string): Db {
  pool ??= new pg.Pool({ connectionString, max: 5 });
  const p = pool;
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await p.query(text, params);
      return result.rows as T[];
    },
  };
}
