import assert from "node:assert/strict";
import test from "node:test";
import { resolveScenarioDataPolicy, type ScenarioDataPolicyRequirement } from "./scenario-data-policy";

function requirement(overrides: Partial<ScenarioDataPolicyRequirement> = {}): ScenarioDataPolicyRequirement {
  return {
    key: "fixture.field",
    inputRole: "scenario",
    fieldCapability: { kind: "email" },
    ...overrides,
  };
}

test("resolves scenario data generation conservatively from structured metadata", () => {
  assert.equal(resolveScenarioDataPolicy(requirement()), "synthetic_allowed");
  assert.equal(resolveScenarioDataPolicy(requirement({ fieldCapability: { kind: "tel" } })), "synthetic_allowed");
  assert.equal(resolveScenarioDataPolicy(requirement({ fieldCapability: { kind: "number", constraints: { min: 1, max: 9 } } })), "synthetic_allowed");
  assert.equal(resolveScenarioDataPolicy(requirement({ fieldCapability: { kind: "date" } })), "synthetic_allowed");
  assert.equal(resolveScenarioDataPolicy(requirement({ fieldCapability: { kind: "datetime" } })), "synthetic_allowed");

  assert.equal(resolveScenarioDataPolicy(requirement({ fieldCapability: { kind: "text" } })), "manual_required");
  assert.equal(resolveScenarioDataPolicy(requirement({ fieldCapability: { kind: "select", allowedValues: ["A"] } })), "manual_required");
  assert.equal(resolveScenarioDataPolicy(requirement({ sensitive: true })), "trusted_required");
  assert.equal(resolveScenarioDataPolicy(requirement({ fieldCapability: { kind: "password" } })), "trusted_required");
  assert.equal(resolveScenarioDataPolicy(requirement({ inputIntent: { mode: "leave_unset" } })), "explicit_value");
  assert.equal(resolveScenarioDataPolicy(requirement({ inputIntent: { mode: "invalid_value" } })), "explicit_value");
  assert.equal(resolveScenarioDataPolicy(requirement({ inputIntent: { mode: "preserve_state" } })), "explicit_value");
  assert.equal(resolveScenarioDataPolicy(requirement({ inputIntent: { mode: "set_value" }, explicitValue: "known" })), "explicit_value");
  assert.equal(resolveScenarioDataPolicy(requirement({ fieldCapability: { kind: "unknown" } })), "unresolved");
  assert.equal(resolveScenarioDataPolicy(requirement({ inputRole: "supporting" })), "unresolved");
  assert.equal(resolveScenarioDataPolicy({ key: "different.key", label: "Different", source: "contract" } as any), "unresolved");
});
