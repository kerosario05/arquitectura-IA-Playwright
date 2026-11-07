import { strict as assert } from "node:assert";
import { test } from "node:test";
import { jobStore } from "./job-store";
import { scheduleJob } from "./job-scheduler";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("queues jobs until a slot is released and skips a cancelled queued job", async () => {
  const previous = process.env.QA_LAB_MAX_CONCURRENT_JOBS;
  process.env.QA_LAB_MAX_CONCURRENT_JOBS = "1";
  const first = jobStore.create("scenario-preview", {});
  const cancelled = jobStore.create("scenario-preview", {});
  const next = jobStore.create("scenario-preview", {});
  const started: string[] = [];
  try {
    for (const job of [first, cancelled, next]) {
      scheduleJob(job.id, () => { started.push(job.id); jobStore.update(job.id, { status: "running" }); });
    }
    await tick();
    assert.deepEqual(started, [first.id]);
    assert.equal(jobStore.get(next.id)?.status, "queued");
    assert.equal(jobStore.get(cancelled.id)?.queuePosition, 1);
    assert.equal(jobStore.get(next.id)?.queuePosition, 2);
    jobStore.update(cancelled.id, { status: "cancelled", completedAt: new Date().toISOString() });
    assert.equal(jobStore.get(next.id)?.queuePosition, 1);
    jobStore.update(first.id, { status: "done", completedAt: new Date().toISOString() });
    await tick();
    assert.deepEqual(started, [first.id, next.id]);
    assert.equal(jobStore.get(next.id)?.status, "running");
  } finally {
    jobStore.update(next.id, { status: "cancelled", completedAt: new Date().toISOString() });
    if (previous === undefined) delete process.env.QA_LAB_MAX_CONCURRENT_JOBS;
    else process.env.QA_LAB_MAX_CONCURRENT_JOBS = previous;
  }
});
