import "../config/env"; // Load .env before touching the datasource
import {
  BackupError,
  createBackup,
  listBackups,
  pruneBackups,
  resolveBackupDir,
  resolveRetentionDays,
} from "../db/backup";
import { closeConnection, describeDatasource } from "../db/sql-connection";

/**
 * Takes a verified snapshot of the database and prunes old ones.
 *
 * Meant to be driven by the Windows Task Scheduler on the server; safe to run
 * while the engine is serving traffic.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printHelp(): void {
  console.log(`
  npm run db:backup -- [opciones]

  Crea un respaldo consistente (VACUUM INTO) sin detener el servicio y elimina
  los antiguos según la retención.

  Opciones:
    --list           Solo lista los respaldos existentes
    --no-prune       No eliminar respaldos antiguos
    --dir <ruta>     Carpeta destino (default: BACKUP_DIR o data/backups)
    --retention <n>  Días a conservar (default: BACKUP_RETENTION_DAYS o 14)

  Variables de entorno: BACKUP_DIR, BACKUP_RETENTION_DAYS
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const dirIndex = argv.indexOf("--dir");
  const retentionIndex = argv.indexOf("--retention");
  const backupDir = dirIndex !== -1 ? argv[dirIndex + 1] : resolveBackupDir();
  const retentionDays =
    retentionIndex !== -1 ? Number(argv[retentionIndex + 1]) : resolveRetentionDays();

  console.log(`\n[backup] origen    : ${describeDatasource()}`);
  console.log(`[backup] destino   : ${backupDir}`);

  if (argv.includes("--list")) {
    const existing = listBackups(backupDir);
    if (existing.length === 0) {
      console.log(`[backup] no hay respaldos todavía\n`);
      return;
    }
    console.log(`[backup] ${existing.length} respaldo(s):\n`);
    for (const entry of existing) {
      console.log(`  ${entry.name}  ${formatBytes(entry.bytes).padStart(9)}  ${entry.createdAt.toISOString()}`);
    }
    console.log("");
    return;
  }

  const result = createBackup({ backupDir });
  console.log(
    `[backup] creado    : ${result.file}\n` +
      `[backup] tamaño    : ${formatBytes(result.bytes)} (origen ${formatBytes(result.sourceBytes)})\n` +
      `[backup] verificado: integrity_check ok, ${result.tables} tablas\n` +
      `[backup] duración  : ${result.durationMs} ms`,
  );

  if (!argv.includes("--no-prune")) {
    const pruned = pruneBackups({ backupDir, retentionDays });
    if (pruned.removed.length > 0) {
      console.log(`[backup] purgados  : ${pruned.removed.length} con más de ${retentionDays} días`);
    }
    console.log(`[backup] conservados: ${pruned.kept}`);
  }

  console.log("");
}

main()
  .catch((err) => {
    if (err instanceof BackupError) {
      console.error(`\n[backup] falló (${err.code}): ${err.message}\n`);
    } else {
      console.error(`\n[backup] falló:`, err instanceof Error ? err.message : err, "\n");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection().catch(() => {});
  });
