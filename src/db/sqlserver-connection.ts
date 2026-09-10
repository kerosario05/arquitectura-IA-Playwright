import { createRequire } from "node:module";
import type { DbConnection } from "./db-connection";

/**
 * SQL Server driver (original behaviour), kept behind DB_DRIVER=sqlserver.
 *
 * `odbc` is a native module and is not a declared dependency, so it is required
 * lazily — importing this file with DB_DRIVER=sqlite must never touch it.
 */

const requireModule = createRequire(__filename);

let odbc: any = null;

function getOdbc(): any {
  if (odbc) return odbc;
  try {
    odbc = requireModule("odbc");
  } catch {
    throw new Error(
      'DB_DRIVER=sqlserver requires the "odbc" package (npm install odbc) plus the ' +
        "ODBC Driver 18 for SQL Server. Use DB_DRIVER=sqlite to run without it.",
    );
  }
  return odbc;
}

function buildConnectionString(): string {
  const server = process.env.SQL_SERVER_HOST?.trim() || "localhost";
  const database = process.env.SQL_SERVER_DATABASE?.trim() || "QA_LAB";
  const trusted = (process.env.SQL_SERVER_TRUSTED_CONNECTION ?? "true").toLowerCase() === "true";
  return trusted
    ? `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${database};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;`
    : `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${database};Encrypt=no;TrustServerCertificate=yes;`;
}

let pool: DbConnection | null = null;

export async function getConnection(): Promise<DbConnection> {
  if (pool) return pool;
  pool = await getOdbc().connect(buildConnectionString());
  return pool!;
}

export async function closeConnection(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export async function withTransaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
  const conn: DbConnection = await getOdbc().connect(buildConnectionString());
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback failure; original error propagates
    }
    throw err;
  } finally {
    try {
      await conn.close();
    } catch {
      // ignore close failure
    }
  }
}
