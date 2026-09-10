import assert from "node:assert/strict";
import test from "node:test";
import { jobStore } from "./job-store";

test("job API never exposes transient runtime values and completion clears them", () => {
  const job = jobStore.create("discovery-batch", {
    runtimeEntriesByCase: {
      "case-1": [{
        key: "auth.password",
        value: "transient-value",
        source: "user_provided_qa_credentials",
        sensitive: true,
      }],
    },
  });

  const publicJob = jobStore.get(job.id);
  const publicEntries = (publicJob?.params.runtimeEntriesByCase as Record<string, Array<Record<string, unknown>>>)["case-1"];
  assert.deepEqual(publicEntries, [{
    key: "auth.password",
    source: "user_provided_qa_credentials",
    sensitive: true,
    present: true,
  }]);
  assert.equal(JSON.stringify(publicJob).includes("transient-value"), false);

  const internalJob = jobStore.getInternal(job.id);
  assert.equal(JSON.stringify(internalJob?.params).includes("transient-value"), true);
  jobStore.clearTransientParams(job.id);
  assert.equal(Object.prototype.hasOwnProperty.call(internalJob?.params ?? {}, "runtimeEntriesByCase"), false);
});
