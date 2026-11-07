import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The Portal serves a customer's stored bureau data only while `DatosGenerales.FechaProceso` is within
 * the consult tolerance (sp_GetConsulta); an older record is moved to history and re-requested from
 * TransUnion, which replaces what the service had selected (a clean 2025 profile came back as a
 * 776-score one). Preparing a cédula keeps the stored data valid: when its master date is old, set it to
 * today, after saving every row that belongs to the cédula so the change can be undone.
 */
export type SqlRunner = (text: string, params: Record<string, string>) => Promise<{ rows: any[]; rowsAffected: number }>;

export type PrepareResult =
  | { status: "fresh"; days: number }
  | { status: "prepared"; days: number; backupFile: string }
  | { status: "missing" };

const BACKUP_TABLES = ["DatosGenerales", "CVScore", "CVIncomeEstimator", "BSCVariables", "Activas", "Inactivas"] as const;

export function dataCedulasPrepareEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DATA_CEDULAS_PREPARE?.trim().toLowerCase() !== "false";
}

/** Master dates up to this many days old are left alone: the Portal already trusts them. */
export function dataCedulasPrepareFreshDays(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.DATA_CEDULAS_PREPARE_FRESH_DAYS);
  return env.DATA_CEDULAS_PREPARE_FRESH_DAYS !== undefined && Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 30;
}

export async function prepareCedulaRecord(
  run: SqlRunner,
  cedula: string,
  options: { freshDays: number; backupDir: string; now?: Date },
): Promise<PrepareResult> {
  const id = cedula.trim();
  const master = (await run(`SELECT DATEDIFF(day, FechaProceso, GETDATE()) AS days FROM dbo.DatosGenerales WHERE LTRIM(RTRIM(Cedula)) = @c`, { c: id })).rows[0];
  if (!master) return { status: "missing" };
  const days = Number(master.days);
  if (days <= options.freshDays) return { status: "fresh", days };

  const tables: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = (await run(`SELECT * FROM dbo.${table} WHERE LTRIM(RTRIM(Cedula)) = @c`, { c: id })).rows;
  }
  mkdirSync(options.backupDir, { recursive: true });
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(options.backupDir, `${id}-${stamp}.json`);
  writeFileSync(backupFile, JSON.stringify({ cedula: id, masterAgeDays: days, takenAt: (options.now ?? new Date()).toISOString(), tables }));

  const updated = await run(`UPDATE dbo.DatosGenerales SET FechaProceso = GETDATE() WHERE LTRIM(RTRIM(Cedula)) = @c`, { c: id });
  if (updated.rowsAffected !== 1) throw new Error(`prepare_update_unexpected_rows:${updated.rowsAffected}`);
  return { status: "prepared", days, backupFile };
}
