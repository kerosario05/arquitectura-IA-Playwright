import odbc from "odbc";
import { config as loadEnv } from "dotenv";

loadEnv();

const server = process.env.SQL_SERVER_HOST?.trim() || "localhost";
const database = process.env.SQL_SERVER_DATABASE?.trim() || "QA_LAB";
const trustedConnection =
  (process.env.SQL_SERVER_TRUSTED_CONNECTION ?? "true").toLowerCase() === "true";

const connectionString = trustedConnection
  ? `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${database};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;`
  : `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${database};Encrypt=no;TrustServerCertificate=yes;`;

let _pool: odbc.Connection | null = null;

export async function getConnection(): Promise<odbc.Connection> {
  if (_pool) return _pool;
  _pool = await odbc.connect(connectionString);
  return _pool;
}

export async function closeConnection(): Promise<void> {
  if (_pool) {
    await _pool.close();
    _pool = null;
  }
}

export async function withTransaction<T>(
  fn: (conn: odbc.Connection) => Promise<T>
): Promise<T> {
  const conn = await odbc.connect(connectionString);
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

export { odbc };
