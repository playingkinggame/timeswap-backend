import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USE_PG = !!process.env.DATABASE_URL;

let pgPool = null;
let sqlite = null;

/**
 * Two backends, one query surface:
 *  - Production: real Postgres (Neon/Supabase) via `pg`, set DATABASE_URL.
 *  - Local/demo: bundled SQLite via better-sqlite3 (zero setup, seeded data).
 * Write SQL in Postgres style ($1, $2, ... and RETURNING) everywhere else
 * in the app — this module adapts placeholders for SQLite automatically.
 */

if (USE_PG) {
  const { Pool } = await import("pg");
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
} else {
  const Database = (await import("better-sqlite3")).default;
  const dbPath = path.join(__dirname, "..", "timeswap.dev.sqlite");
  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const ddl = fs.readFileSync(path.join(__dirname, "..", "sqlite_schema.sql"), "utf-8");
  sqlite.exec(ddl);
}

function toSqliteSql(text) {
  // $1 -> ?, $2 -> ? ... Every $N in a query must be distinct and supplied in
  // order (don't reuse the same $N twice — pass the value again instead).
  return text.replace(/\$\d+/g, "?");
}

/** Run a query, get all rows back. */
export async function all(text, params = []) {
  if (USE_PG) {
    const res = await pgPool.query(text, params);
    return res.rows;
  }
  const stmt = sqlite.prepare(toSqliteSql(text));
  return stmt.all(...params);
}

/** Run a query, get the first row back (or undefined). */
export async function get(text, params = []) {
  const rows = await all(text, params);
  return rows[0];
}

/** Run a mutation (INSERT/UPDATE/DELETE), optionally with RETURNING. */
export async function run(text, params = []) {
  if (USE_PG) {
    const res = await pgPool.query(text, params);
    return { rows: res.rows, changes: res.rowCount };
  }
  const sql = toSqliteSql(text);
  const stmt = sqlite.prepare(sql);
  if (/returning/i.test(sql)) {
    const rows = stmt.all(...params);
    return { rows, changes: rows.length };
  }
  const info = stmt.run(...params);
  return { rows: [], changes: info.changes, lastID: info.lastInsertRowid };
}

export const backend = USE_PG ? "postgres" : "sqlite";
