import assert from "node:assert/strict";
import test from "node:test";
import { resolveExistingCaseExecutionPlan } from "./launch-orchestrator";

test("new automatable case is admitted for discovery when no promoted spec exists", () => {
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [90001],
    appSlug: "synthetic-app",
    sectionSlug: "synthetic-section",
    entries: [],
    caseContracts: new Map([[90001, {
      usable: false,
      reasonCode: "targeted_gap_resolution_required",
      recommendedRoute: "targeted_discovery",
    }]]),
  });

  assert.deepEqual(plan.existingSpec, []);
  assert.equal(plan.mcpRequired.length, 1);
  assert.deepEqual(plan.blocked, []);
  assert.equal(plan.admitted.length, 1);
  assert.equal(plan.admitted[0].mcpRequired, true);
  assert.equal(plan.launchAccepted, true);
});

test("existing valid promoted spec remains reusable", () => {
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [90002],
    appSlug: "synthetic-app",
    sectionSlug: "synthetic-section",
    entries: [{
      id: "synthetic-automation",
      caseId: 90002,
      appSlug: "synthetic-app",
      status: "active",
      pomStatus: "promoted",
      specVerificationStatus: "passed",
    } as any],
    validateSpec: () => ({ reusable: true, reason: "promoted_spec_valid", specPath: "synthetic.spec.ts" }),
  });

  assert.equal(plan.existingSpec.length, 1);
  assert.deepEqual(plan.mcpRequired, []);
  assert.deepEqual(plan.blocked, []);
  assert.equal(plan.launchAccepted, true);
});
