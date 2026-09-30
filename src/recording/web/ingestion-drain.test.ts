import assert from "node:assert/strict";
import test from "node:test";
import { drainIngestionUntilQuiet, type IngestionDrainSource } from "./ingestion-drain";

/** A serialized queue shaped like WebSessionRecorder's v2IngestionQueue, with a pending counter. */
class FakeQueue implements IngestionDrainSource {
  private queue: Promise<unknown> = Promise.resolve();
  private count = 0;
  private accepted = 0;
  applied: string[] = [];

  enqueue(name: string, durationMs: number): void {
    this.count += 1;
    this.accepted += 1;
    this.queue = this.queue
      .then(() => new Promise((resolve) => setTimeout(resolve, durationMs)))
      .then(() => { this.applied.push(name); })
      .finally(() => { this.count -= 1; });
  }

  tail(): Promise<unknown> { return this.queue; }
  pending(): number { return this.count; }
  generation(): number { return this.accepted; }
}

test("work that arrives WHILE draining is also applied (the lost 'Atrás' click)", async () => {
  const queue = new FakeQueue();
  queue.enqueue("4", 40);
  // A browser message already in flight when Stop was pressed lands during the drain.
  setTimeout(() => queue.enqueue("Atrás", 20), 50);

  const result = await drainIngestionUntilQuiet(queue, { timeoutMs: 2_000, settleMs: 100 });

  assert.equal(result.drained, true);
  assert.deepEqual(queue.applied, ["4", "Atrás"]);
  assert.ok(result.extraRounds >= 1);
});

test("an empty queue drains after one settle window", async () => {
  const queue = new FakeQueue();
  const result = await drainIngestionUntilQuiet(queue, { timeoutMs: 1_000, settleMs: 20 });
  assert.equal(result.drained, true);
  assert.equal(result.extraRounds, 0);
  assert.ok(result.waitedMs < 500);
});

test("a hung capture no longer holds Stop forever: bounded, and reports what was left", async () => {
  const queue = new FakeQueue();
  queue.enqueue("hung-screenshot", 10_000);
  queue.enqueue("next", 10);

  const started = Date.now();
  const result = await drainIngestionUntilQuiet(queue, { timeoutMs: 200, settleMs: 50 });

  assert.equal(result.drained, false);
  assert.equal(result.pendingAtDeadline, 2);
  assert.ok(Date.now() - started < 1_000);
});

test("a rejected link in the queue still counts as settled", async () => {
  let pending = 1;
  const failing = Promise.reject(new Error("screenshot failed")).finally(() => { pending = 0; });
  failing.catch(() => undefined);
  const result = await drainIngestionUntilQuiet(
    { tail: () => failing, pending: () => pending, generation: () => 1 },
    { timeoutMs: 500, settleMs: 20 },
  );
  assert.equal(result.drained, true);
});

test("a tail rebuilt on every call (Promise.all) still drains as soon as it is quiet", async () => {
  // The recorder passes tail: () => Promise.all([queue, ...inflight]) -- a new object each call.
  // Judging "nothing new" by promise identity made every Stop wait out the whole budget.
  const queue = new FakeQueue();
  queue.enqueue("last-click", 30);
  const result = await drainIngestionUntilQuiet(
    { tail: () => Promise.all([queue.tail()]), pending: () => queue.pending(), generation: () => queue.generation() },
    { timeoutMs: 5_000, settleMs: 50 },
  );
  assert.equal(result.drained, true);
  assert.ok(result.waitedMs < 1_000, `waited ${result.waitedMs} ms`);
  assert.equal(result.extraRounds, 0);
});
