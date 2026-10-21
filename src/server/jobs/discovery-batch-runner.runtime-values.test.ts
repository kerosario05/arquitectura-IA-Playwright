import assert from "node:assert/strict";
import test from "node:test";
import { persistRuntimeValuesForExecutedCase } from "./discovery-batch-runner";

test("persists sensitive and ordinary inputs after a failed promoted-spec attempt for the same case", async () => {
  let persistedInput: any;
  const count = await persistRuntimeValuesForExecutedCase({
    projectSlug: "app-b",
    caseId: 4171,
    executionStatus: "failed",
    entries: [
      { key: "auth.username", value: "qa-user", source: "manual_runtime", sensitive: true },
      { key: "auth.password", value: "qa-password", source: "manual_runtime", sensitive: true },
    ],
    persist: async (input) => {
      persistedInput = input;
      return input.values.length;
    },
  });

  assert.equal(count, 2);
  assert.equal(persistedInput.projectSlug, "app-b");
  assert.equal(persistedInput.caseId, 4171);
  assert.deepEqual(persistedInput.values.map((entry: any) => entry.key), ["auth.username", "auth.password"]);
  assert.ok(persistedInput.values.every((entry: any) => entry.verified === true));
});

test("does not persist when no project scope or runtime inputs are available", async () => {
  let calls = 0;
  const persist = async () => { calls += 1; return 1; };
  assert.equal(await persistRuntimeValuesForExecutedCase({ caseId: 1, executionStatus: "passed", entries: [{ key: "a", value: "b", source: "manual_runtime", sensitive: false }], persist: persist as any }), 0);
  assert.equal(await persistRuntimeValuesForExecutedCase({ projectSlug: "app-a", caseId: 1, executionStatus: "passed", entries: [], persist: persist as any }), 0);
  assert.equal(calls, 0);
});
