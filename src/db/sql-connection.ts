import { config as loadEnv } from "dotenv";
import type { DbConnection } from "./db-connection";
import * as sqlite from "./sqlite-connection";
import * as sqlserver from "./sqlserver-connection";

loadEnv();

export type { DbConnection, DbRow } from "./db-connection";

export type DbDriverName = "sqlite" | "sqlserver";

export function resolveDriverName(): DbDriverName {
  const raw = (process.env.DB_DRIVER || "sqlite").trim().toLowerCase();
  if (raw === "sqlserver" || raw === "mssql") return "sqlserver";
  if (raw === "sqlite") return "sqlite";
  throw new Error(`Unsupported DB_DRIVER "${raw}" — expected "sqlite" or "sqlserver"`);
}

function driver() {
  return resolveDriverName() === "sqlserver" ? sqlserver : sqlite;
}

/** Human-readable description of the active datastore, for logs and CLIs. */
export function describeDatasource(): string {
  if (resolveDriverName() === "sqlserver") {
    const server = process.env.SQL_SERVER_HOST?.trim() || "localhost";
    const database = process.env.SQL_SERVER_DATABASE?.trim() || "QA_LAB";
    return `sqlserver ${server}/${database}`;
  }
  return `sqlite ${sqlite.resolveDbPath()}`;
}

export async function getConnection(): Promise<DbConnection> {
  return driver().getConnection();
}

export async function closeConnection(): Promise<void> {
  return driver().closeConnection();
}

export async function withTransaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
  return driver().withTransaction(fn);
}
