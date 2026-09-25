import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Snapshot, verification and retention, against a throwaway database.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-backup-"));
const dbPath = path.join(tempDir, "source.db");
const backupDir = path.join(tempDir, "backups");
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = dbPath;

const failures: string[] = [];

async function test(label: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures.push(label);
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const sqlConnection = await import("./sql-connection");
  const backup = await import("./backup");

  const conn = await sqlConnection.getConnection();
  // Real content so a snapshot has something to prove.
  await conn.query(
    `INSERT INTO dbo.Projects (slug, name, projectType, status, enabled) VALUES (?, ?, 1, 1, 1)`,
    ["kiosko", "Kiosko"],
  );

  console.log(`\n[test] origen: ${dbPath}`);
  console.log("\ncrear respaldo");

  let firstFile = "";

  await test("crea un archivo verificado", () => {
    const result = backup.createBackup({ backupDir });
    firstFile = result.file;
    assert.ok(fs.existsSync(result.file), "el archivo existe");
    assert.ok(result.bytes > 0, "no está vacío");
    assert.ok(result.tables >= 18, `esperaba las tablas del esquema, vi ${result.tables}`);
    assert.ok(result.durationMs >= 0);
  });

  await test("el respaldo contiene los datos del origen", () => {
    const handle = new DatabaseSync(firstFile, { readOnly: true });
    try {
      const rows = handle.prepare("SELECT slug, name FROM Projects").all() as { slug: string; name: string }[];
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].slug, "kiosko");
      assert.strictEqual(rows[0].name, "Kiosko");
    } finally {
      handle.close();
    }
  });

  await test("el nombre lleva marca de tiempo y ordena cronológicamente", () => {
    const early = backup.backupFileName(new Date("2026-01-02T03:04:05.000Z"));
    const late = backup.backupFileName(new Date("2026-11-02T03:04:05.000Z"));
    assert.strictEqual(early, "qa-lab-2026-01-02T03-04-05.db");
    assert.ok(early < late, "el orden alfabético coincide con el cronológico");
    assert.ok(!/[:]/.test(early), "sin caracteres inválidos para Windows");
  });

  await test("se niega a sobrescribir un respaldo existente", () => {
    const when = new Date("2026-05-05T05:05:05.000Z");
    backup.createBackup({ backupDir, now: when });
    assert.throws(
      () => backup.createBackup({ backupDir, now: when }),
      (err: unknown) => {
        assert.ok(err instanceof backup.BackupError);
        assert.strictEqual(err.code, "already_exists");
        return true;
      },
    );
  });

  await test("el respaldo refleja escrituras posteriores", async () => {
    await conn.query(
      `INSERT INTO dbo.Projects (slug, name, projectType, status, enabled) VALUES (?, ?, 1, 1, 1)`,
      ["portal", "Portal"],
    );
    const result = backup.createBackup({ backupDir, now: new Date("2026-06-06T06:06:06.000Z") });
    const handle = new DatabaseSync(result.file, { readOnly: true });
    try {
      const rows = handle.prepare("SELECT COUNT(*) AS n FROM Projects").all() as { n: number }[];
      assert.strictEqual(Number(rows[0].n), 2, "ve el proyecto añadido después del primer respaldo");
    } finally {
      handle.close();
    }
  });

  console.log("\nverificación");

  await test("un archivo corrupto se rechaza y se elimina", () => {
    const corrupt = path.join(backupDir, "qa-lab-2020-01-01T00-00-00.db");
    fs.writeFileSync(corrupt, "esto no es una base de datos");
    assert.throws(
      () => backup.verifyBackup(corrupt),
      (err: unknown) => {
        assert.ok(err instanceof backup.BackupError);
        return true;
      },
    );
    assert.ok(!fs.existsSync(corrupt), "un respaldo que no verifica no puede quedarse aparentando ser válido");
  });

  await test("una base vacía sin tablas se rechaza", () => {
    const empty = path.join(backupDir, "qa-lab-2020-02-02T00-00-00.db");
    new DatabaseSync(empty).close();
    assert.throws(
      () => backup.verifyBackup(empty),
      (err: unknown) => {
        assert.ok(err instanceof backup.BackupError);
        assert.strictEqual(err.code, "empty");
        return true;
      },
    );
    assert.ok(!fs.existsSync(empty));
  });

  console.log("\nretención");

  await test("elimina los que superan la ventana", () => {
    const old = path.join(backupDir, "qa-lab-2019-01-01T00-00-00.db");
    fs.copyFileSync(firstFile, old);
    const ancient = new Date(Date.now() - 60 * 86_400_000);
    fs.utimesSync(old, ancient, ancient);

    const result = backup.pruneBackups({ backupDir, retentionDays: 14 });
    assert.ok(result.removed.includes(path.basename(old)), `no purgó: ${result.removed.join(",")}`);
    assert.ok(!fs.existsSync(old));
  });

  await test("nunca borra el más reciente, aunque todos hayan caducado", () => {
    // Age every snapshot past the window: without the guard the folder would end
    // up empty, which is the one outcome a retention policy must never produce.
    const before = backup.listBackups(backupDir);
    assert.ok(before.length > 1, `hacen falta varios, hay ${before.length}`);
    before.forEach((entry, index) => {
      // Staggered so "newest" stays unambiguous.
      const when = new Date(Date.now() - (60 + index) * 86_400_000);
      fs.utimesSync(path.join(backupDir, entry.name), when, when);
    });

    const result = backup.pruneBackups({ backupDir, retentionDays: 14 });
    const after = backup.listBackups(backupDir);
    assert.strictEqual(after.length, 1, `quedó ${after.length}`);
    assert.strictEqual(after[0].name, before[0].name, "el superviviente es el más nuevo");
    assert.strictEqual(result.kept, 1);
    assert.strictEqual(result.removed.length, before.length - 1);
  });

  await test("listBackups ordena del más nuevo al más viejo", () => {
    backup.createBackup({ backupDir, now: new Date("2026-07-07T07-07-07".replace(/-(\d\d)-(\d\d)$/, ":$1:$2")) });
    const listed = backup.listBackups(backupDir);
    assert.ok(listed.length >= 2);
    for (let i = 1; i < listed.length; i++) {
      assert.ok(
        listed[i - 1].createdAt.getTime() >= listed[i].createdAt.getTime(),
        "orden descendente por fecha",
      );
    }
  });

  await test("una carpeta que no existe no rompe nada", () => {
    const missing = path.join(tempDir, "no-existe");
    assert.deepStrictEqual(backup.listBackups(missing), []);
    assert.deepStrictEqual(backup.pruneBackups({ backupDir: missing }), { removed: [], kept: 0 });
  });

  console.log("\nconfiguración");

  await test("respeta BACKUP_RETENTION_DAYS y descarta valores inválidos", () => {
    const original = process.env.BACKUP_RETENTION_DAYS;
    try {
      process.env.BACKUP_RETENTION_DAYS = "30";
      assert.strictEqual(backup.resolveRetentionDays(), 30);
      process.env.BACKUP_RETENTION_DAYS = "cero";
      assert.strictEqual(backup.resolveRetentionDays(), 14, "vuelve al default");
      process.env.BACKUP_RETENTION_DAYS = "-5";
      assert.strictEqual(backup.resolveRetentionDays(), 14);
      delete process.env.BACKUP_RETENTION_DAYS;
      assert.strictEqual(backup.resolveRetentionDays(), 14);
    } finally {
      if (original === undefined) delete process.env.BACKUP_RETENTION_DAYS;
      else process.env.BACKUP_RETENTION_DAYS = original;
    }
  });

  await test("rechaza el respaldo si el driver no es SQLite", () => {
    process.env.DB_DRIVER = "sqlserver";
    try {
      assert.throws(
        () => backup.createBackup({ backupDir }),
        (err: unknown) => {
          assert.ok(err instanceof backup.BackupError);
          assert.strictEqual(err.code, "unsupported_driver");
          return true;
        },
      );
    } finally {
      process.env.DB_DRIVER = "sqlite";
    }
  });

  await sqlConnection.closeConnection();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All backup tests passed.\n");
  }
}

main().catch((err) => {
  console.error(err);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
  process.exitCode = 1;
});
