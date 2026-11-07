import assert from "node:assert/strict";
import test from "node:test";
import { isDiscoveryOnlyPassWithSpecsDisabled } from "./discovery-batch-runner";

const base = { specGenerationDisabled: true, isJiraChild: false, childExitCode: 0, discoveryState: "discovered_passed" };

test("specs off: a TestRail case whose discovery passed is a finished case", () => {
  assert.equal(isDiscoveryOnlyPassWithSpecsDisabled(base), true);
  assert.equal(isDiscoveryOnlyPassWithSpecsDisabled({ ...base, discoveryState: "discovery_passed" }), true);
  assert.equal(isDiscoveryOnlyPassWithSpecsDisabled({ ...base, discoveryState: "Promoted" }), true);
});

test("specs on: nothing changes (promotion keeps deciding the outcome)", () => {
  assert.equal(isDiscoveryOnlyPassWithSpecsDisabled({ ...base, specGenerationDisabled: false }), false);
});

test("a failed or partial discovery never passes, whatever the switch says", () => {
  for (const discoveryState of ["exploration_failed", "failed", "discovered_partial", "blocked", undefined]) {
    assert.equal(isDiscoveryOnlyPassWithSpecsDisabled({ ...base, discoveryState }), false, String(discoveryState));
  }
  assert.equal(isDiscoveryOnlyPassWithSpecsDisabled({ ...base, childExitCode: 1 }), false);
});

test("a Jira child keeps its own decision path", () => {
  assert.equal(isDiscoveryOnlyPassWithSpecsDisabled({ ...base, isJiraChild: true }), false);
});
