/**
 * Driver-agnostic connection shape.
 *
 * Mirrors the subset of the `odbc` Connection API this codebase actually uses, so
 * repositories/services can run against SQLite or SQL Server without changes.
 */
export type DbRow = Record<string, any>;

export interface DbConnection {
  query<T = DbRow>(sql: string, params?: unknown[]): Promise<T[]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}
