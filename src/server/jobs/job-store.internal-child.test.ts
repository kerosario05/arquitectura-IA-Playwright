import assert from "node:assert/strict";
import test from "node:test";
import { jobStore } from "./job-store";

/**
 * Mixed rerun needs a subset runner to own its own jobId (for independent live progress/status,
 * process ownership, and SSE) without that job appearing as an unrelated, independent run in
 * GET /api/runs/. jobStore had no parent/child or hidden-job concept at all: list() returned
 * every job with zero filtering, so any internal child job would leak into the public run list.
 * This adds the minimal, backward-compatible fix: an optional parentJobId on Job, and list()
 * excluding jobs that carry one by default (opt back in with { includeInternal: true } for
 * infrastructure that must see every job, e.g. device-busy checks).
 */

test("1. a normal job (no parentJobId) appears in the default jobStore.list()", () => {
  const job = jobStore.create("scenario-preview", {});
  assert.equal(job.parentJobId, undefined);
  const ids = jobStore.list().map((j) => j.id);
  assert.ok(ids.includes(job.id));
});

test("2. a child job created with parentJobId is excluded from the default jobStore.list()", () => {
  const parent = jobStore.create("scenario-preview", {});
  const child = jobStore.create("scenario-preview", {}, { parentJobId: parent.id });
  const ids = jobStore.list().map((j) => j.id);
  assert.ok(!ids.includes(child.id), "child must not appear in the default (public) listing");
});

test("3. the child job appears when includeInternal: true is passed", () => {
  const parent = jobStore.create("scenario-preview", {});
  const child = jobStore.create("scenario-preview", {}, { parentJobId: parent.id });
  const ids = jobStore.list({ includeInternal: true }).map((j) => j.id);
  assert.ok(ids.includes(child.id));
  assert.ok(ids.includes(parent.id));
});

test("4. the child job remains directly addressable via jobStore.get(childId) regardless of listing", () => {
  const parent = jobStore.create("scenario-preview", {});
  const child = jobStore.create("scenario-preview", { foo: "bar" }, { parentJobId: parent.id });
  const fetched = jobStore.get(child.id);
  assert.ok(fetched);
  assert.equal(fetched!.id, child.id);
  assert.deepEqual(fetched!.params, { foo: "bar" });
});

test("5. the child job preserves its correct parentJobId", () => {
  const parent = jobStore.create("scenario-preview", {});
  const child = jobStore.create("scenario-preview", {}, { parentJobId: parent.id });
  assert.equal(jobStore.get(child.id)!.parentJobId, parent.id);
  assert.equal(jobStore.get(parent.id)!.parentJobId, undefined, "the parent itself is never internal");
});

test("6. a public parent job still appears exactly once in the default listing, even with children present", () => {
  const parent = jobStore.create("scenario-preview", {});
  jobStore.create("scenario-preview", {}, { parentJobId: parent.id });
  jobStore.create("scenario-preview", {}, { parentJobId: parent.id });
  const matches = jobStore.list().filter((j) => j.id === parent.id);
  assert.equal(matches.length, 1);
});

test("7. subscribe still works on a child job (SSE/polling remain functional for internal children)", () => {
  const parent = jobStore.create("scenario-preview", {});
  const child = jobStore.create("scenario-preview", {}, { parentJobId: parent.id });
  let received: string | undefined;
  const unsubscribe = jobStore.subscribe(child.id, {
    onLog: (line) => { received = line; },
    onUpdate: () => {},
  });
  jobStore.appendLog(child.id, "hello from child");
  assert.equal(received, "hello from child");
  unsubscribe();
});

test("8. existing 2-argument create(type, params) callers are unaffected — no parentJobId, fully public", () => {
  const job = jobStore.create("scenario-preview", { scenarios: [] });
  assert.equal(job.parentJobId, undefined);
  assert.ok(jobStore.list().some((j) => j.id === job.id));
});
