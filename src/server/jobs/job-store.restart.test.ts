import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

// The store is a process singleton anchored at process.cwd(), so each "server process" is a
// separate tsx child running in the same temporary cwd: the first one dies mid-run (a deploy
// stopping the service), the second one starts afterwards.
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const storeUrl = pathToFileURL(path.join(__dirname, "job-store.ts")).href;

function runInProcess(cwd: string, body: string): string {
  const script = path.join(cwd, `step-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`);
  fs.writeFileSync(script, `import { jobStore } from ${JSON.stringify(storeUrl)};\n${body}\n`);
  // Both "server processes" must share one history folder, like the real service does.
  const env = { ...process.env, QA_RUN_HISTORY_DIR: path.join(cwd, ".artifacts", "qa-lab-run-history") };
  return execFileSync(process.execPath, [tsxCli, script], { cwd, encoding: "utf8", env });
}

test("a run cut short by a restart comes back as failed/interrupted, with its logs, and stays listed", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "job-store-restart-"));
  try {
    const ids = JSON.parse(runInProcess(cwd, `
      const finished = jobStore.create("scenario-preview", { appSlug: "kiosko", huTitle: "Terminada" });
      jobStore.update(finished.id, { status: "running", startedAt: new Date().toISOString() });
      jobStore.appendLog(finished.id, "caso 1 ok");
      jobStore.update(finished.id, { status: "done", completedAt: new Date().toISOString(), summary: { passed: 1, failed: 0 } });

      const running = jobStore.create("scenario-preview", { appSlug: "kiosko", huTitle: "En curso", launchId: "L-1" });
      jobStore.update(running.id, { status: "running", startedAt: new Date().toISOString(), summary: { passed: 2, failed: 1 } });
      jobStore.appendLog(running.id, "caso 1 ok");
      jobStore.appendLog(running.id, "caso 2 ejecutando");

      const child = jobStore.create("scenario-preview", { appSlug: "kiosko" }, { parentJobId: running.id });
      jobStore.update(child.id, { status: "running" });

      console.log(JSON.stringify({ finished: finished.id, running: running.id, child: child.id }));
      process.exit(0); // the service stops: nothing gets to finish the running job
    `).trim());

    const after = JSON.parse(runInProcess(cwd, `
      const ids = ${JSON.stringify(ids)};
      console.log(JSON.stringify({
        finished: jobStore.getAny(ids.finished),
        running: jobStore.getAny(ids.running),
        child: jobStore.getPersisted(ids.child),
        listed: jobStore.list().map((job) => job.id),
      }));
    `).trim());

    assert.equal(after.finished.status, "done");
    assert.deepEqual(after.finished.logs, ["caso 1 ok"]);

    assert.equal(after.running.status, "failed");
    assert.equal(after.running.summary.reasonCode, "interrupted_by_restart");
    assert.equal(after.running.summary.passed, 2, "progress reached before the restart is kept");
    assert.equal(after.running.params.launchId, "L-1");
    assert.match(after.running.errorMessage, /Interrumpida/);
    assert.ok(after.running.completedAt);
    assert.deepEqual(after.running.logs.slice(0, 2), ["caso 1 ok", "caso 2 ejecutando"]);
    assert.match(after.running.logs[2], /Interrumpida/);

    assert.equal(after.child.status, "failed");
    assert.ok(after.listed.includes(ids.finished));
    assert.ok(after.listed.includes(ids.running));
    assert.ok(!after.listed.includes(ids.child), "child jobs stay out of the public list");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
