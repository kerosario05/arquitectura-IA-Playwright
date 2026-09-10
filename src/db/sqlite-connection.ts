import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import type { DbConnection } from "./db-connection";
import { SQLITE_SCHEMA, UTC_NOW_EXPR } from "./sqlite-schema";

/**
 * SQLite driver exposing the same surface the repositories expect from `odbc`.
 *
 * The whole point is that src/db/* and src/server/routes/projects.ts keep their
 * T-SQL flavoured queries: `translateSql` rewrites the handful of SQL Server
 * constructs this codebase uses into their SQLite equivalents.
 */

let db: DatabaseSync | null = null;
let dbPath: string | null = null;

export function resolveDbPath(): string {
  const configured = process.env.SQLITE_DB_PATH?.trim();
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.resolve(process.cwd(), "data", "qa-lab.db");
}

function openDatabase(): DatabaseSync {
  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec("PRAGMA foreign_keys = ON");
  handle.exec("PRAGMA busy_timeout = 5000");
  handle.exec(SQLITE_SCHEMA);
  dbPath = file;
  return handle;
}

export function getDatabase(): DatabaseSync {
  if (!db) db = openDatabase();
  return db;
}

export function getDatabasePath(): string {
  getDatabase();
  return dbPath!;
}

// ---------------------------------------------------------------------------
// T-SQL -> SQLite translation
// ---------------------------------------------------------------------------

const LOCK_HINTS = /\bWITH\s*\(\s*(?:UPDLOCK|ROWLOCK|NOLOCK|HOLDLOCK|READPAST|READCOMMITTED)(?:\s*,\s*(?:UPDLOCK|ROWLOCK|NOLOCK|HOLDLOCK|READPAST|READCOMMITTED))*\s*\)/gi;
const OUTPUT_CLAUSE = /\bOUTPUT\s+((?:INSERTED|DELETED)\.\w+(?:\s*,\s*(?:INSERTED|DELETED)\.\w+)*)\s*/i;

export function translateSql(sql: string): string {
  let out = sql;

  // `dbo.Projects` -> `Projects`
  out = out.replace(/\bdbo\./gi, "");

  // Locking hints have no SQLite equivalent; transactions already serialize writes.
  out = out.replace(LOCK_HINTS, " ");

  // UTC clock functions
  out = out.replace(/\b(?:SYSUTCDATETIME|GETUTCDATE)\s*\(\s*\)/gi, UTC_NOW_EXPR);

  // `OUTPUT INSERTED.a, INSERTED.b ... VALUES (...)` -> `... VALUES (...) RETURNING a, b`
  const outputMatch = out.match(OUTPUT_CLAUSE);
  if (outputMatch) {
    const columns = outputMatch[1]
      .split(",")
      .map((c) => c.trim().replace(/^(?:INSERTED|DELETED)\./i, ""))
      .join(", ");
    out = out.replace(OUTPUT_CLAUSE, " ").trimEnd();
    out = `${out} RETURNING ${columns}`;
  }

  return out;
}

/**
 * Decodes a Buffer parameter back to text.
 *
 * The knowledge persisters bind `Buffer.from(json, "utf16le")` because SQL Server's
 * NVARCHAR binding requires it. SQLite stores text as UTF-8, so a raw Buffer would
 * land as a BLOB and break `JSON.parse` on read. A UTF-16LE round-trip check keeps
 * genuine binary payloads (none today) from being mangled.
 */
function bufferToText(buf: Buffer): string {
  if (buf.length % 2 === 0) {
    const decoded = buf.toString("utf16le");
    if (Buffer.from(decoded, "utf16le").equals(buf)) return decoded;
  }
  return buf.toString("utf8");
}

export function normalizeParam(value: unknown): string | number | bigint | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return bufferToText(value);
  if (value instanceof Uint8Array) return bufferToText(Buffer.from(value));
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  // Objects/arrays are only ever bound as JSON payloads in this codebase.
  return JSON.stringify(value);
}

function runQuery<T>(sql: string, params: unknown[] = []): T[] {
  const statement = getDatabase().prepare(translateSql(sql));
  const rows = statement.all(...params.map(normalizeParam)) as Record<string, unknown>[];
  // node:sqlite returns null-prototype objects; spread them so callers can use
  // `{ ...row }`, `res.json(row)` and instanceof-free property access safely.
  return rows.map((row) => ({ ...row })) as T[];
}

// ---------------------------------------------------------------------------
// Connection surface
// ---------------------------------------------------------------------------

class SqliteConnection implements DbConnection {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return runQuery<T>(sql, params);
  }

  // Explicit transaction control is unused by the repositories (they go through
  // `withTransaction`), but kept so the surface matches the odbc driver.
  async beginTransaction(): Promise<void> {
    getDatabase().exec("BEGIN IMMEDIATE");
  }
  async commit(): Promise<void> {
    getDatabase().exec("COMMIT");
  }
  async rollback(): Promise<void> {
    getDatabase().exec("ROLLBACK");
  }
  async close(): Promise<void> {
    // No-op: the process shares a single handle, closed via closeConnection().
  }
}

const sharedConnection = new SqliteConnection();

export async function getConnection(): Promise<DbConnection> {
  getDatabase();
  return sharedConnection;
}

export async function closeConnection(): Promise<void> {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
  }
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * Unlike odbc — where every transaction got its own connection — SQLite shares a
 * single handle, so overlapping `withTransaction` calls would interleave their
 * BEGIN/COMMIT. Top-level transactions are serialized through a promise chain;
 * a transaction opened inside another one becomes a SAVEPOINT instead.
 */
const txContext = new AsyncLocalStorage<{ depth: number }>();
let txChain: Promise<unknown> = Promise.resolve();

async function runTransaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
  const handle = getDatabase();
  const parent = txContext.getStore();
  const depth = parent ? parent.depth + 1 : 0;
  const savepoint = depth > 0 ? `sp_tx_${depth}` : null;

  if (savepoint) handle.exec(`SAVEPOINT ${savepoint}`);
  else handle.exec("BEGIN IMMEDIATE");

  try {
    const result = await txContext.run({ depth }, () => fn(sharedConnection));
    if (savepoint) handle.exec(`RELEASE ${savepoint}`);
    else handle.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      if (savepoint) handle.exec(`ROLLBACK TO ${savepoint}`);
      else handle.exec("ROLLBACK");
    } catch {
      // ignore rollback failure; the original error propagates
    }
    throw err;
  }
}

export async function withTransaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
  // Nested call: already inside the serialized section, run it as a savepoint.
  if (txContext.getStore()) return runTransaction(fn);

  const task = () => runTransaction(fn);
  const next = txChain.then(task, task);
  txChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
