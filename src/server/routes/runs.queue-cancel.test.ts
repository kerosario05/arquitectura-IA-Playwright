import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { runsRouter } from "./runs";
import { jobStore } from "../jobs/job-store";
import { scheduleJob } from "../jobs/job-scheduler";

test("DELETE cancels a queued job without launching its runner", async () => {
  const previous = process.env.QA_LAB_MAX_CONCURRENT_JOBS;
  process.env.QA_LAB_MAX_CONCURRENT_JOBS = "1";
  const running = jobStore.create("scenario-preview", {});
  const waiting = jobStore.create("scenario-preview", {});
  let launched = false;
  const app = express();
  app.use("/api/runs", runsRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    scheduleJob(running.id, () => {});
    scheduleJob(waiting.id, () => { launched = true; });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://localhost:${address.port}/api/runs/${waiting.id}`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(jobStore.get(waiting.id)?.status, "cancelled");
    jobStore.update(running.id, { status: "done", completedAt: new Date().toISOString() });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(launched, false);
  } finally {
    jobStore.update(running.id, { status: "done", completedAt: new Date().toISOString() });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.QA_LAB_MAX_CONCURRENT_JOBS;
    else process.env.QA_LAB_MAX_CONCURRENT_JOBS = previous;
  }
});
