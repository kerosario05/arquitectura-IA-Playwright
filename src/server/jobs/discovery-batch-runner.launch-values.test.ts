import assert from "node:assert/strict";
import test from "node:test";
import { persistLaunchValuesForCases } from "./discovery-batch-runner";

test("typed launch values are saved per case, restored ones and blanks are not", async () => {
  const saved: Array<{ caseId: number; keys: string[] }> = [];
  const count = await persistLaunchValuesForCases("job-1", {
    appSlug: "app",
    runtimeEntriesByCase: {
      "57451": [
        { key: "auth.username", value: "user" },
        { key: "auth.password", value: "pass" },
        { key: "empty", value: "  " },
        { key: "old", value: "restored", provenance: "confirmed_case_runtime" },
      ],
      "57452": [],
      "abc": [{ key: "x", value: "y" }],
    } as never,
  }, async (input) => {
    saved.push({ caseId: input.caseId, keys: input.entries.map((entry) => entry.key) });
    return input.entries.length;
  });
  assert.equal(count, 2);
  assert.deepEqual(saved, [{ caseId: 57451, keys: ["auth.username", "auth.password"] }]);
});

test("a persistence failure for one case does not stop the launch", async () => {
  const count = await persistLaunchValuesForCases("job-2", {
    appSlug: "app",
    runtimeEntriesByCase: { "1": [{ key: "a", value: "b" }], "2": [{ key: "c", value: "d" }] } as never,
  }, async (input) => {
    if (input.caseId === 1) throw new Error("db down");
    return 1;
  });
  assert.equal(count, 1);
});

test("without an app slug nothing is saved", async () => {
  assert.equal(await persistLaunchValuesForCases("job-3", { runtimeEntriesByCase: { "1": [{ key: "a", value: "b" }] } as never }), 0);
});
