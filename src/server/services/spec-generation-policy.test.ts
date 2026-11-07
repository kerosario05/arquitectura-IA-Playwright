import assert from "node:assert/strict";
import test from "node:test";
import { isJiraDiscoveryOnlyPass, isJiraSpecGenerationEnabled } from "./spec-generation-policy";

test("Jira spec-generation flag accepts the documented disabled values and defaults enabled", () => {
  assert.equal(isJiraSpecGenerationEnabled({}), true);
  for (const value of ["false", "0", "off", "no", "disabled"]) {
    assert.equal(isJiraSpecGenerationEnabled({ JIRA_SPEC_GENERATION_ENABLED: value }), false, value);
  }
  assert.equal(isJiraSpecGenerationEnabled({ JIRA_SPEC_GENERATION_ENABLED: "true" }), true);
});

test("only a passed Jira Discovery with spec generation disabled is a discovery-only pass", () => {
  const passingDiscovery = {
    childExitCode: 0,
    childStatus: "passed",
    specGenerationStatus: "skipped",
  };
  assert.equal(isJiraDiscoveryOnlyPass(passingDiscovery), true);
  assert.equal(isJiraDiscoveryOnlyPass({ ...passingDiscovery, childStatus: "failed" }), false);
  assert.equal(isJiraDiscoveryOnlyPass({ ...passingDiscovery, childExitCode: 1 }), false);
  assert.equal(isJiraDiscoveryOnlyPass({ ...passingDiscovery, specGenerationStatus: "passed" }), false);
});
