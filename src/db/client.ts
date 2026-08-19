/**
 * Database connection.
 *
 * Uses the standard Postgres driver rather than a hosting-specific one, so the
 * same code runs against a local Postgres in development and against a managed
 * Postgres in production with nothing but a different connection string.
 *
 * The pool is cached on globalThis because Next reloads modules on every edit
 * in development, and a fresh pool per reload exhausts the server's connection
 * limit within a few minutes.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  return url;
}

const globalForDb = globalThis as unknown as { pool?: Pool };

function getPool(): Pool {
  if (!globalForDb.pool) {
    const url = connectionString();
    globalForDb.pool = new Pool({
      connectionString: url,
      // Managed Postgres requires TLS; a local server generally does not.
      ssl: url.includes("localhost") || url.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: false },
      max: 10,
    });
  }
  return globalForDb.pool;
}

export const db = drizzle(getPool(), { schema });

export { schema };
