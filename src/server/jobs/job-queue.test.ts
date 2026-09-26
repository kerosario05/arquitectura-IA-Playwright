import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Admission control: what happens when more people launch than the server can
 * run at once.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-queue-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(tempDir, "queue-test.db");
process.env.MAX_CONCURRENT_EXECUTIONS = "3";
process.env.MAX_CONCURRENT_RECORDINGS = "2";

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

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const sqlConnection = await import("../../db/sql-connection");
  const { jobStore } = await import("./job-store");
  const { jobQueue, limitFor } = await import("./job-queue");

  console.log(`\n[test] límites: ejecución=${limitFor("execution")}, grabación=${limitFor("recording")}`);

  /** Launches `count` jobs that block until released, mimicking real runs. */
  function launch(count: number): { ids: string[]; started: string[]; release: (id: string) => void } {
    const started: string[] = [];
    const releasers = new Map<string, () => void>();
    const ids: string[] = [];

    for (let i = 0; i < count; i++) {
      const job = jobStore.create("discovery-batch", { appSlug: `proyecto-${i}` });
      ids.push(job.id);
      jobQueue.schedule(job.id, "execution", () => {
        started.push(job.id);
        jobStore.update(job.id, { status: "running", startedAt: new Date().toISOString() });
        return new Promise<void>((resolve) => releasers.set(job.id, resolve));
      });
    }
    return {
      ids,
      started,
      release: (id) => {
        releasers.get(id)?.();
        releasers.delete(id);
      },
    };
  }

  console.log("\ncinco personas lanzando a la vez");

  const batch = launch(5);
  await tick();

  await test("solo arrancan 3; las otras 2 quedan en cola", async () => {
    assert.strictEqual(batch.started.length, 3, `arrancaron ${batch.started.length}`);
    assert.deepStrictEqual(batch.started, batch.ids.slice(0, 3));
  });

  await test("las que esperan aparecen como 'queued', no perdidas", async () => {
    for (const id of batch.ids.slice(3)) {
      assert.strictEqual(jobStore.get(id)?.status, "queued");
    }
  });

  await test("la cola informa la posición de cada una", async () => {
    assert.strictEqual(jobQueue.positionOf(batch.ids[3]), 1, "la cuarta es la siguiente");
    assert.strictEqual(jobQueue.positionOf(batch.ids[4]), 2, "la quinta va después");
    assert.strictEqual(jobQueue.positionOf(batch.ids[0]), 0, "una que ya corre no está en cola");
  });

  await test("el conteo de capacidad refleja la realidad", async () => {
    const stats = jobQueue.stats();
    assert.strictEqual(stats.running.execution, 3);
    assert.strictEqual(stats.queued, 2);
    assert.strictEqual(stats.limits.execution, 3);
    assert.strictEqual(jobQueue.hasCapacity("execution"), false);
  });

  await test("al terminar una, entra la cuarta automáticamente", async () => {
    batch.release(batch.ids[0]);
    await tick(30);
    assert.strictEqual(batch.started.length, 4);
    assert.strictEqual(batch.started[3], batch.ids[3]);
    assert.strictEqual(jobStore.get(batch.ids[3])?.status, "running");
    assert.strictEqual(jobQueue.stats().queued, 1);
  });

  await test("se respeta el orden de llegada", async () => {
    batch.release(batch.ids[1]);
    await tick(30);
    assert.strictEqual(batch.started[4], batch.ids[4], "la quinta entra después de la cuarta");
    assert.strictEqual(jobQueue.stats().queued, 0);
  });

  await test("ninguna se pierde: las cinco acabaron arrancando", async () => {
    assert.strictEqual(batch.started.length, 5);
    assert.deepStrictEqual([...batch.started].sort(), [...batch.ids].sort());
  });

  await test("al liberarlas todas, la capacidad vuelve a cero", async () => {
    for (const id of batch.ids) batch.release(id);
    await tick(30);
    assert.strictEqual(jobQueue.stats().running.execution, 0);
    assert.strictEqual(jobQueue.hasCapacity("execution"), true);
  });

  console.log("\ncancelar mientras se espera");

  await test("una cancelada en cola nunca arranca", async () => {
    const pending = launch(5);
    await tick();
    assert.strictEqual(pending.started.length, 3);

    const waiting = pending.ids[4];
    assert.strictEqual(jobQueue.cancel(waiting), true);
    jobStore.update(waiting, { status: "cancelled", completedAt: new Date().toISOString() });

    // Two passes: releasing the running ones lets the queued one start, and it
    // registers its releaser only then. One pass would leave it holding a slot.
    for (let pass = 0; pass < 2; pass++) {
      for (const id of pending.ids) pending.release(id);
      await tick(30);
    }

    assert.ok(!pending.started.includes(waiting), "la cancelada no llegó a ejecutarse");
    assert.strictEqual(jobStore.get(waiting)?.status, "cancelled");
    assert.strictEqual(jobQueue.stats().running.execution, 0, "no quedan cupos ocupados");
  });

  await test("cancelar una que ya corre no la saca de la cola", async () => {
    assert.strictEqual(jobQueue.cancel("no-existe"), false);
  });

  console.log("\nfallos y aislamiento");

  await test("una que revienta libera su espacio igual", async () => {
    const job = jobStore.create("sprint", {});
    jobQueue.schedule(job.id, "execution", () => {
      throw new Error("explotó el runner");
    });
    await tick(30);

    assert.strictEqual(jobQueue.stats().running.execution, 0, "el cupo se devolvió");
    assert.strictEqual(jobStore.get(job.id)?.status, "failed");
    assert.match(String(jobStore.get(job.id)?.errorMessage), /explotó el runner/);
  });

  await test("los tipos no compiten entre sí por el mismo cupo", async () => {
    const stats = jobQueue.stats();
    assert.strictEqual(stats.limits.recording, 2);
    assert.strictEqual(stats.limits.emulator, 1);
    // Filling executions must leave recording capacity untouched.
    const filler = launch(3);
    await tick();
    assert.strictEqual(jobQueue.hasCapacity("execution"), false);
    assert.strictEqual(jobQueue.hasCapacity("recording"), true, "grabar sigue disponible");
    for (const id of filler.ids) filler.release(id);
    await tick(30);
  });

  await jobStore.drain();
  await sqlConnection.closeConnection();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All job queue tests passed.\n");
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
