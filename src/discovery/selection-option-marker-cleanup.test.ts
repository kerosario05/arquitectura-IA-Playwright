import assert from "node:assert/strict";
import test from "node:test";
import { cleanupSelectionOptionMarker } from "./selection-option-marker-cleanup";

test("does not wait for a marked option that detached after selection", async () => {
  let evaluateCalls = 0;
  await cleanupSelectionOptionMarker({
    count: async () => 0,
    evaluate: async (_fn, _arg, _options) => { evaluateCalls += 1; },
  }, "data-codex-selection-option");

  assert.equal(evaluateCalls, 0);
});

test("bounds marker cleanup if the option detaches between count and evaluate", async () => {
  const startedAt = Date.now();
  await cleanupSelectionOptionMarker({
    count: async () => 1,
    evaluate: async (_fn, _arg, _options) => new Promise<void>(() => undefined),
  }, "data-codex-selection-option", 20);

  assert.ok(Date.now() - startedAt < 500, "optional cleanup must not block the verified selection");
});
