import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Persistence and restart recovery for the job store, against a throwaway
 * SQLite file. The datasource is pinned before the db modules load — see the
 * note in src/db/identity-repository.test.ts.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-jobs-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(tempDir, "jobs-test.db");

const failures: string[] = [];

async function test(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures.push(label);
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const sqlConnection = await import("../../db/sql-connection");
  const { JobStore } = await import("./job-store");
  const jobs = await import("../../db/job-repository");

  const conn = await sqlConnection.getConnection();
  console.log(`\n[test] datasource: ${sqlConnection.describeDatasource()}`);

  console.log("\npersistencia");

  const store = new JobStore();
  let jobId = "";

  await test("crear un job lo escribe en SQLite", async () => {
    const job = store.create("discovery-batch", { appSlug: "kiosko", caseIds: [1, 2] });
    jobId = job.id;
    assert.strictEqual(job.status, "queued");

    await store.drain();
    const rows = await conn.query<{ n: number }>("SELECT COUNT(*) AS n FROM dbo.Jobs WHERE id = ?", [jobId]);
    assert.strictEqual(Number(rows[0].n), 1);

    const stored = await jobs.listRecentJobs(10);
    const found = stored.find((j) => j.id === jobId);
    assert.ok(found);
    assert.strictEqual(found.type, "discovery-batch");
    assert.deepStrictEqual(found.params, { appSlug: "kiosko", caseIds: [1, 2] });
  });

  await test("los cambios de estado se persisten", async () => {
    store.update(jobId, { status: "running", startedAt: new Date().toISOString() });
    await store.drain();
    const stored = (await jobs.listRecentJobs(10)).find((j) => j.id === jobId);
    assert.strictEqual(stored?.status, "running");
    assert.ok(stored?.startedAt);
  });

  await test("los logs se escriben por lotes, no uno por línea", async () => {
    for (let i = 0; i < 120; i++) store.appendLog(jobId, `línea ${i}`);
    await store.drain();
    const count = await jobs.countJobLogLines(jobId);
    assert.strictEqual(count, 120);

    const loaded = await jobs.loadJobLogs(jobId, 500);
    assert.strictEqual(loaded[0], "línea 0");
    assert.strictEqual(loaded[119], "línea 119");
  });

  await test("no se duplican los logs al volver a volcar", async () => {
    await store.drain();
    assert.strictEqual(await jobs.countJobLogLines(jobId), 120);
  });

  await test("el resumen y el error se persisten", async () => {
    store.update(jobId, {
      status: "completed_with_failures",
      completedAt: new Date().toISOString(),
      exitCode: 1,
      errorMessage: "2 casos fallaron",
      summary: { totalStories: 5, synced: 5, passed: 3, failed: 2 },
    });
    await store.drain();
    const stored = (await jobs.listRecentJobs(10)).find((j) => j.id === jobId);
    assert.strictEqual(stored?.status, "completed_with_failures");
    assert.strictEqual(stored?.exitCode, 1);
    assert.strictEqual(stored?.errorMessage, "2 casos fallaron");
    assert.deepStrictEqual(stored?.summary, { totalStories: 5, synced: 5, passed: 3, failed: 2 });
    assert.ok(stored?.durationMs !== undefined, "la duración se calcula al completar");
  });

  // ------------------------------------------------------------------------
  console.log("\nrecuperación tras un reinicio");

  let runningId = "";
  let queuedId = "";

  await test("deja jobs en vuelo para simular una caída", async () => {
    const running = store.create("sprint", { appSlug: "kiosko" });
    runningId = running.id;
    store.update(runningId, { status: "running", startedAt: new Date().toISOString() });
    store.appendLog(runningId, "arrancando sprint");

    const queued = store.create("scenario-preview", { appSlug: "portal-comercial" });
    queuedId = queued.id;

    await store.drain();
    const stored = await jobs.listRecentJobs(10);
    assert.strictEqual(stored.find((j) => j.id === runningId)?.status, "running");
    assert.strictEqual(stored.find((j) => j.id === queuedId)?.status, "queued");
  });

  const revived = new JobStore();

  await test("una instancia nueva recupera los jobs de SQLite", async () => {
    const report = await revived.hydrate();
    assert.strictEqual(report.restored, 3, "los tres jobs vuelven a memoria");
    assert.strictEqual(report.interrupted, 2, "el running y el queued se cierran");

    assert.strictEqual(revived.list().length, 3);
    const recovered = revived.get(jobId);
    assert.strictEqual(recovered?.status, "completed_with_failures");
    assert.deepStrictEqual(recovered?.params, { appSlug: "kiosko", caseIds: [1, 2] });
  });

  await test("los jobs en vuelo quedan como fallidos con el motivo", async () => {
    for (const id of [runningId, queuedId]) {
      const recovered = revived.get(id);
      assert.strictEqual(recovered?.status, "failed", `job ${id}`);
      assert.strictEqual(recovered?.errorMessage, jobs.INTERRUPTED_MESSAGE);
      assert.ok(recovered?.completedAt, "se les pone fecha de fin");
    }
  });

  await test("los logs vuelven con el job", async () => {
    const recovered = revived.get(jobId);
    assert.strictEqual(recovered?.logs.length, 120);
    assert.strictEqual(recovered?.logs[0], "línea 0");
    assert.strictEqual(revived.get(runningId)?.logs[0], "arrancando sprint");
  });

  await test("seguir escribiendo tras recuperar no duplica logs", async () => {
    revived.appendLog(jobId, "línea nueva tras el reinicio");
    await revived.drain();
    assert.strictEqual(await jobs.countJobLogLines(jobId), 121);
    const loaded = await jobs.loadJobLogs(jobId, 500);
    assert.strictEqual(loaded[120], "línea nueva tras el reinicio");
  });

  await test("un segundo arranque ya no encuentra nada que interrumpir", async () => {
    const again = new JobStore();
    const report = await again.hydrate();
    assert.strictEqual(report.interrupted, 0);
    assert.strictEqual(report.restored, 3);
  });

  // ------------------------------------------------------------------------
  console.log("\nlímites y limpieza");

  await test("la hidratación no revive el manejador del proceso hijo", async () => {
    const recovered = revived.getInternal(runningId);
    assert.ok(recovered);
    assert.strictEqual(recovered.process, undefined, "un proceso muerto no se puede recuperar");
    assert.ok(recovered.emitter, "pero sí tiene emisor para SSE");
  });

  await test("borrar un job lo quita de memoria y de SQLite", async () => {
    const throwaway = revived.create("mobile-test-run", {});
    revived.appendLog(throwaway.id, "algo");
    await revived.drain();

    revived.remove(throwaway.id);
    await revived.drain();

    assert.strictEqual(revived.get(throwaway.id), undefined);
    const rows = await conn.query<{ n: number }>("SELECT COUNT(*) AS n FROM dbo.Jobs WHERE id = ?", [throwaway.id]);
    assert.strictEqual(Number(rows[0].n), 0);
    assert.strictEqual(await jobs.countJobLogLines(throwaway.id), 0, "sus logs también");
  });

  await test("la purga elimina jobs antiguos y sus logs", async () => {
    const old = revived.create("sprint", {});
    await revived.drain();
    await conn.query("UPDATE dbo.Jobs SET createdAt = ? WHERE id = ?", [
      new Date(Date.now() - 60 * 86_400_000).toISOString(),
      old.id,
    ]);

    const pruned = await jobs.pruneOldJobs(30);
    assert.strictEqual(pruned, 1);
    const rows = await conn.query<{ n: number }>("SELECT COUNT(*) AS n FROM dbo.Jobs WHERE id = ?", [old.id]);
    assert.strictEqual(Number(rows[0].n), 0);
  });

  await test("un job reciente sobrevive a la purga", async () => {
    const before = (await jobs.listRecentJobs(100)).length;
    assert.strictEqual(await jobs.pruneOldJobs(30), 0);
    assert.strictEqual((await jobs.listRecentJobs(100)).length, before);
  });

  await test("un fallo de escritura no rompe la ejecución en memoria", async () => {
    // Close the datasource so the next persist attempt fails.
    const isolated = new JobStore();
    const job = isolated.create("sprint", {});
    isolated.appendLog(job.id, "sigue funcionando");
    isolated.update(job.id, { status: "running" });
    // Memory is authoritative regardless of what SQLite did.
    assert.strictEqual(isolated.get(job.id)?.status, "running");
    assert.strictEqual(isolated.get(job.id)?.logs.length, 1);
    await isolated.drain();
  });

  await sqlConnection.closeConnection();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All job store tests passed.\n");
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
