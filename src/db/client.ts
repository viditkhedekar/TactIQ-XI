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
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

    globalForDb.pool = new Pool({
      connectionString: url,
      // Managed Postgres requires TLS; a local server generally does not.
      ssl: isLocal ? undefined : { rejectUnauthorized: false },

      /*
       * Serverless wants a small pool, not a big one.
       *
       * On Vercel every concurrent request is its own instance with its own
       * pool, so `max` multiplies across instances rather than being shared. At
       * 10 it took only a handful of concurrent requests to exhaust a managed
       * Postgres's connection limit, after which new connections queue behind a
       * handshake instead of being served. One connection per instance is the
       * right shape: an instance handles one request at a time anyway.
       *
       * Locally the opposite is true, where one process serves everything.
       */
      max: isLocal ? 10 : 1,

      // A cold instance pays TCP + TLS + auth before its first query, which is
      // most of the delay on an otherwise trivial page. Holding the connection
      // open well past a single request means a warm instance skips all of it.
      idleTimeoutMillis: 30_000,
      // Fail loudly rather than hanging the page for a minute if the database
      // is unreachable or out of connections.
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    });
  }
  return globalForDb.pool;
}

export const db = drizzle(getPool(), { schema });

export { schema };
