import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { runsRouter } from "./runs";
import { jobStore } from "../jobs/job-store";

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use("/api/runs", runsRouter);
  let server: Server | undefined;
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server!.address();
  assert.ok(address && typeof address === "object");
  const port = typeof address === "object" && address ? address.port : 0;
  try { await fn(`http://localhost:${port}`); }
  finally { await new Promise<void>((resolve) => server!.close(() => resolve())); }
}

async function main(): Promise<void> {
  const job = jobStore.create("scenario-preview", { appSlug: "logs-offset-fixture" });
  jobStore.appendLog(job.id, "first");
  jobStore.appendLog(job.id, "second");
  jobStore.appendLog(job.id, "third");

  await withServer(async (baseUrl) => {
    const legacyResponse = await fetch(`${baseUrl}/api/runs/${job.id}`);
    const legacy = await legacyResponse.json() as { logs: string[]; logsOffset?: number };
    assert.deepEqual(legacy.logs, ["first", "second", "third"]);
    assert.equal(legacy.logsOffset, undefined);

    const incrementalResponse = await fetch(`${baseUrl}/api/runs/${job.id}?logsAfter=2`);
    const incremental = await incrementalResponse.json() as { logs: string[]; logsOffset: number; totalLogs: number };
    assert.deepEqual(incremental.logs, ["third"]);
    assert.equal(incremental.logsOffset, 2);
    assert.equal(incremental.totalLogs, 3);

    const invalidResponse = await fetch(`${baseUrl}/api/runs/${job.id}?logsAfter=-1`);
    assert.equal(invalidResponse.status, 400);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
