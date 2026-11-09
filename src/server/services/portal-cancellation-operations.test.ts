import assert from "node:assert/strict";
import test from "node:test";
import { PortalCancellationError } from "./portal-comercial-request-cancellation";
import {
  CancellationAlreadyRunningError,
  getCancellationOperation,
  getLatestCancellationOperation,
  resetCancellationOperations,
  startCancellationOperation,
} from "./portal-cancellation-operations";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

test("a long run reports progress while it works and the final result when it ends", async () => {
  resetCancellationOperations();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = startCancellationOperation("p", "radames", async (onProgress) => {
    onProgress([], 3);
    onProgress(["a"], 3);
    await gate;
    onProgress(["a", "b"], 3);
    return { cancelledIds: ["a", "b"], failed: null };
  });
  await settle();
  const running = getCancellationOperation("p", operation.id)!;
  assert.equal(running.status, "running");
  assert.deepEqual(running.cancelledIds, ["a"], "progress is visible before the run ends");
  assert.equal(running.total, 3, "the size of the reviewed list is known while it runs");
  release();
  await settle();
  const done = getCancellationOperation("p", operation.id)!;
  assert.equal(done.status, "done");
  assert.deepEqual(done.cancelledIds, ["a", "b"]);
  assert.equal(done.failed, null);
  assert.ok(done.finishedAt);
});

test("only one run per project at a time; another project is independent", async () => {
  resetCancellationOperations();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = startCancellationOperation("p", "radames", async () => { await gate; return { cancelledIds: [], failed: null }; });
  assert.throws(() => startCancellationOperation("p", "radames", async () => ({ cancelledIds: [], failed: null })),
    (error: unknown) => error instanceof CancellationAlreadyRunningError && error.operationId === first.id);
  assert.doesNotThrow(() => startCancellationOperation("other", "radames", async () => ({ cancelledIds: [], failed: null })));
  release();
  await settle();
  assert.doesNotThrow(() => startCancellationOperation("p", "radames", async () => ({ cancelledIds: [], failed: null })), "free again once it ends");
});

test("a failure keeps the code and message of a known error and hides unknown ones", async () => {
  resetCancellationOperations();
  const known = startCancellationOperation("a", "x", async () => { throw new PortalCancellationError("credentials_rejected", 401, "El Portal rechazó las credenciales."); });
  const unknown = startCancellationOperation("b", "x", async () => { throw new Error("secret detail with a password"); });
  await settle();
  assert.deepEqual(getCancellationOperation("a", known.id)!.error, { code: "credentials_rejected", message: "El Portal rechazó las credenciales." });
  assert.equal(getCancellationOperation("a", known.id)!.status, "failed");
  const hidden = getCancellationOperation("b", unknown.id)!;
  assert.equal(hidden.error!.code, "cancellation_internal_error");
  assert.equal(JSON.stringify(hidden).includes("password"), false);
});

test("an operation is only readable from its own project", async () => {
  resetCancellationOperations();
  const operation = startCancellationOperation("p", "radames", async () => ({ cancelledIds: [], failed: null }));
  await settle();
  assert.ok(getCancellationOperation("p", operation.id));
  assert.equal(getCancellationOperation("other", operation.id), undefined);
  assert.equal(getCancellationOperation("p", "no-existe"), undefined);
});

test("latest: the run in progress wins, otherwise the most recent one, otherwise nothing", async () => {
  resetCancellationOperations();
  assert.equal(getLatestCancellationOperation("p"), undefined);
  const first = startCancellationOperation("p", "radames", async () => ({ cancelledIds: ["x"], failed: null }));
  await settle();
  assert.equal(getLatestCancellationOperation("p")!.id, first.id, "the last finished one");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const second = startCancellationOperation("p", "radames", async () => { await gate; return { cancelledIds: [], failed: null }; });
  assert.equal(getLatestCancellationOperation("p")!.id, second.id, "the one running now");
  assert.equal(getLatestCancellationOperation("other"), undefined, "scoped to its project");
  release();
  await settle();
});
