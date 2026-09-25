import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDatabase, resolveDbPath } from "./sqlite-connection";
import { resolveDriverName } from "./sql-connection";

/**
 * Consistent snapshots of the SQLite database, taken while the service runs.
 *
 * Copying the file is not safe: with WAL enabled, the `.db` on disk is only part
 * of the picture and a plain copy can land mid-transaction. `VACUUM INTO` asks
 * SQLite itself for a snapshot, which is atomic, compacted, and needs no
 * downtime.
 *
 * Every snapshot is verified before it counts as a backup — an unverified copy
 * is a guess, and the moment you need it is the worst time to find out.
 */

const BACKUP_PREFIX = "qa-lab-";
const BACKUP_SUFFIX = ".db";

export class BackupError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export function resolveBackupDir(): string {
  const configured = process.env.BACKUP_DIR?.trim();
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.resolve(process.cwd(), "data", "backups");
}

export function resolveRetentionDays(): number {
  const raw = process.env.BACKUP_RETENTION_DAYS?.trim();
  if (!raw) return 14;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) return 14;
  return parsed;
}

/** `qa-lab-2026-09-17T15-42-03.db` — sorts chronologically and is filename-safe. */
export function backupFileName(when: Date = new Date()): string {
  const stamp = when.toISOString().replace(/\.\d{3}Z$/, "").replace(/[:]/g, "-");
  return `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`;
}

/** SQLite has no bound parameters in VACUUM INTO; a doubled quote is the escape. */
function quoteSqlPath(target: string): string {
  return `'${target.replace(/'/g, "''")}'`;
}

export type BackupResult = {
  file: string;
  bytes: number;
  sourceBytes: number;
  tables: number;
  durationMs: number;
};

/**
 * Writes a verified snapshot and returns where it landed.
 *
 * A failed verification deletes the file on purpose: a corrupt snapshot sitting
 * in the backup folder is worse than no snapshot, because it looks like one.
 */
export function createBackup(options: { backupDir?: string; now?: Date } = {}): BackupResult {
  if (resolveDriverName() !== "sqlite") {
    throw new BackupError(
      "unsupported_driver",
      "VACUUM INTO es de SQLite. Con DB_DRIVER=sqlserver usa el respaldo nativo del motor.",
    );
  }

  const startedAt = Date.now();
  const backupDir = options.backupDir ?? resolveBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const target = path.join(backupDir, backupFileName(options.now));
  if (fs.existsSync(target)) {
    throw new BackupError("already_exists", `Ya existe un respaldo con ese nombre: ${target}`);
  }

  const source = resolveDbPath();
  // `exec` rather than a prepared statement: VACUUM cannot run inside one.
  getDatabase().exec(`VACUUM INTO ${quoteSqlPath(target)}`);

  if (!fs.existsSync(target)) {
    throw new BackupError("not_written", `SQLite no escribió el respaldo en ${target}`);
  }

  const tables = verifyBackup(target);

  return {
    file: target,
    bytes: fs.statSync(target).size,
    sourceBytes: fs.existsSync(source) ? fs.statSync(source).size : 0,
    tables,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Opens the snapshot and checks it is a healthy database with content.
 * Returns the table count so the caller can report something meaningful.
 */
export function verifyBackup(file: string): number {
  let handle: DatabaseSync | null = null;
  try {
    handle = new DatabaseSync(file, { readOnly: true });
    const integrity = handle.prepare("PRAGMA integrity_check").all() as { integrity_check?: string }[];
    const verdict = integrity[0]?.integrity_check;
    if (verdict !== "ok") {
      throw new BackupError("corrupt", `El respaldo no pasó integrity_check: ${verdict ?? "sin respuesta"}`);
    }
    const tables = handle.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all() as { n: number }[];
    const count = Number(tables[0]?.n ?? 0);
    if (count === 0) {
      throw new BackupError("empty", "El respaldo no contiene ninguna tabla");
    }
    return count;
  } catch (err) {
    // Never leave a snapshot that failed verification looking like a good one.
    try {
      handle?.close();
      handle = null;
      fs.unlinkSync(file);
    } catch {
      // best effort
    }
    if (err instanceof BackupError) throw err;
    throw new BackupError("verify_failed", err instanceof Error ? err.message : String(err));
  } finally {
    try {
      handle?.close();
    } catch {
      // best effort
    }
  }
}

export type PruneResult = { removed: string[]; kept: number };

/**
 * Deletes snapshots older than the retention window, but never the newest one:
 * a misconfigured retention must not leave the folder empty.
 */
export function pruneBackups(options: { backupDir?: string; retentionDays?: number } = {}): PruneResult {
  const backupDir = options.backupDir ?? resolveBackupDir();
  const retentionDays = options.retentionDays ?? resolveRetentionDays();
  if (!fs.existsSync(backupDir)) return { removed: [], kept: 0 };

  const files = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .map((name) => ({ name, full: path.join(backupDir, name) }))
    .map((entry) => ({ ...entry, mtime: fs.statSync(entry.full).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) return { removed: [], kept: 0 };

  const cutoff = Date.now() - retentionDays * 86_400_000;
  const removed: string[] = [];
  // Skip index 0: the most recent snapshot always survives.
  for (const entry of files.slice(1)) {
    if (entry.mtime >= cutoff) continue;
    try {
      fs.unlinkSync(entry.full);
      removed.push(entry.name);
    } catch {
      // A locked file is not worth failing the whole run over.
    }
  }
  return { removed, kept: files.length - removed.length };
}

export function listBackups(backupDir = resolveBackupDir()): { name: string; bytes: number; createdAt: Date }[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .map((name) => {
      const stat = fs.statSync(path.join(backupDir, name));
      return { name, bytes: stat.size, createdAt: stat.mtime };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
