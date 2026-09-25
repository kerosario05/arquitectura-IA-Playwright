import assert from "node:assert/strict";
import test from "node:test";
import { AsyncOperationProgressLease } from "./async-operation-progress-lease";

test("meaningful progress renews only the idle deadline", () => {
  const lease = new AsyncOperationProgressLease({ startedAt: 1000, idleWindowMs: 8000, hardSafetyCapMs: 120000 });
  lease.recordMeaningfulProgress(9000);
  const snapshot = lease.snapshot();

  assert.equal(snapshot.lastMeaningfulProgressAt, 9000);
  assert.equal(snapshot.idleDeadline, 17000);
  assert.equal(snapshot.hardSafetyDeadline, 121000);
});

test("hard safety deadline is never renewed by late progress", () => {
  const lease = new AsyncOperationProgressLease({ startedAt: 1000, idleWindowMs: 8000, hardSafetyCapMs: 120000 });
  const hardDeadline = lease.hardSafetyDeadline;
  lease.recordMeaningfulProgress(120000);
  lease.renewIdleDeadline(8000, 120500);

  assert.equal(lease.hardSafetyDeadline, hardDeadline);
  assert.equal(lease.idleDeadline, 121000);
});

test("idle deadline is capped by the hard safety deadline", () => {
  const lease = new AsyncOperationProgressLease({ startedAt: 1000, idleWindowMs: 8000, hardSafetyCapMs: 10000 });
  lease.recordMeaningfulProgress(9000);

  assert.equal(lease.idleDeadline, 11000);
  assert.equal(lease.hardSafetyDeadline, 11000);
});
