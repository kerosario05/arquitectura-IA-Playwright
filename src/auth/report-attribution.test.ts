import test from "node:test";
import assert from "node:assert/strict";
import { createServicePrincipal, type Principal } from "./principal";
import { withReportAttribution, currentReportAnalyst, evidenceActorEnvironment } from "./report-attribution";
import { jobStore } from "../server/jobs/job-store";

test("authenticated full name overrides client attribution and remains isolated across simultaneous jobs", async () => {
  const principal = (name: string): Principal => ({ ...createServicePrincipal(), kind: "user", userId: name, username: name.toLowerCase(), fullName: name });
  await Promise.all(["Ana QA", "Luis QA"].map(name => withReportAttribution(principal(name), async () => {
    await new Promise(resolve => setImmediate(resolve));
    const job = jobStore.create("scenario-preview", { analystName: "Untrusted payload", scenarios: [] });
    assert.equal(job.params.analystName, name);
    assert.deepEqual(evidenceActorEnvironment(job.params), { EVIDENCE_ANALYST_NAME: name });
    assert.equal(currentReportAnalyst(), name);
  })));
  assert.equal(currentReportAnalyst(), undefined);
});
