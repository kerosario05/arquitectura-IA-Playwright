import assert from "node:assert/strict";
import test from "node:test";
import { drainIngestionUntilQuiet, type IngestionDrainSource } from "./ingestion-drain";

/** A serialized queue shaped like WebSessionRecorder's v2IngestionQueue, with a pending counter. */
class FakeQueue implements IngestionDrainSource {
  private queue: Promise<unknown> = Promise.resolve();
  private count = 0;
  applied: string[] = [];

  enqueue(name: string, durationMs: number): void {
    this.count += 1;
    this.queue = this.queue
      .then(() => new Promise((resolve) => setTimeout(resolve, durationMs)))
      .then(() => { this.applied.push(name); })
      .finally(() => { this.count -= 1; });
  }

  tail(): Promise<unknown> { return this.queue; }
  pending(): number { return this.count; }
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
    { tail: () => failing, pending: () => pending },
    { timeoutMs: 500, settleMs: 20 },
  );
  assert.equal(result.drained, true);
});
