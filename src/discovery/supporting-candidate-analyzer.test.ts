import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSupportingCandidates } from "./supporting-candidate-analyzer";
import { buildRuntimeControlIdentity } from "../types/control-identity";
import type { ExecutionPlanStep } from "../types/execution-plan.types";

const identity = (role: string, name: string) => buildRuntimeControlIdentity({
  tagName: "input", inputType: role === "textbox" ? "email" : undefined, role, name,
  candidateLocator: { strategy: "role", role },
});

const requirement = (key: string, valuePolicy: "scenario_controlled" | "safe_synthetic" | "trusted_required" | "unresolved", kind: string) => ({
  key, source: "contract" as const, valuePolicy, fieldCapability: { kind } as any,
});

const observed = (name: string, overrides: Record<string, unknown> = {}) => ({
  visible: true, disabled: false, required: true, value: "", controlIdentity: identity("textbox", name), ...overrides,
});

const action = { causal: true };

test("classifies scenario-controlled and safe synthetic controls", () => {
  const documentIdentity = identity("textbox", "document-input")!;
  const result = analyzeSupportingCandidates({
    runtimeRequirements: [requirement("document", "scenario_controlled", "text"), requirement("auxiliary", "safe_synthetic", "email")],
    observedControls: [
      observed("document-input", { requirementRef: "document", controlIdentity: documentIdentity }),
      observed("auxiliary-input", { requirementRef: "auxiliary", controlIdentity: identity("textbox", "auxiliary-input") }),
    ],
    executionPlan: [{ index: 1, action: "fill", controlIdentity: documentIdentity, valueKey: "document", requirementRefs: ["document"] }],
    dependentAction: action,
  });
  assert.deepEqual(result.map((item) => item.decision), ["scenario_controlled", "supporting_candidate"]);
});

test("protects every structured non-positive intent and never autofills it", () => {
  for (const mode of ["leave_unset", "invalid_value", "preserve_state"] as const) {
    const controlIdentity = identity("textbox", mode)!;
    const result = analyzeSupportingCandidates({
      runtimeRequirements: [requirement(mode, "safe_synthetic", "email")],
      observedControls: [observed(mode, { controlIdentity })],
      executionPlan: [{ index: 1, action: "fill", controlIdentity, inputIntent: { mode }, requirementRefs: [mode] }],
      dependentAction: action,
    });
    assert.equal(result[0]?.decision, "protected_intent");
  }
});

test("handles trusted, unresolved, complete, identity and causal gates conservatively", () => {
  const cases = [
    [requirement("trusted", "trusted_required", "password"), observed("trusted"), "trusted_required"],
    [requirement("unknown", "unresolved", "unknown"), observed("unknown"), "unresolved"],
    [requirement("complete", "safe_synthetic", "email"), observed("complete", { value: "present" }), "already_satisfied"],
    [requirement("select", "safe_synthetic", "select"), observed("select", { value: "option" }), "already_satisfied"],
  ] as const;
  for (const [runtimeRequirement, control, expected] of cases) {
    assert.equal(analyzeSupportingCandidates({ runtimeRequirements: [runtimeRequirement], observedControls: [control], executionPlan: [], dependentAction: action })[0]?.decision, expected);
  }
  const identityControl = identity("textbox", "same")!;
  assert.equal(analyzeSupportingCandidates({ runtimeRequirements: [requirement("same", "safe_synthetic", "email")], observedControls: [observed("same", { controlIdentity: identityControl })], executionPlan: [{ index: 1, action: "fill", controlIdentity: identityControl, inputIntent: { mode: "set_value" } }], dependentAction: action })[0]?.decision, "scenario_controlled");
  assert.equal(analyzeSupportingCandidates({ runtimeRequirements: [requirement("related", "safe_synthetic", "email")], observedControls: [observed("related", { controlIdentity: null })], executionPlan: [{ index: 1, action: "fill", controlIdentity: identity("textbox", "other")!, value: "x" }], dependentAction: action })[0]?.decision, "unresolved");
  assert.equal(analyzeSupportingCandidates({ runtimeRequirements: [requirement("no-cause", "safe_synthetic", "email")], observedControls: [observed("no-cause")], executionPlan: [], dependentAction: undefined })[0]?.decision, "unresolved");
});

test("deduplicates supporting candidates by structural fingerprint and avoids text metadata", () => {
  const controlIdentity = identity("textbox", "duplicate")!;
  const result = analyzeSupportingCandidates({
    runtimeRequirements: [requirement("duplicate", "safe_synthetic", "email")],
    observedControls: [observed("duplicate", { controlIdentity }), observed("duplicate", { controlIdentity })],
    executionPlan: [], dependentAction: action,
  });
  assert.equal(result.filter((item) => item.decision === "supporting_candidate").length, 1);
  assert.equal(JSON.stringify(result).includes('"label"'), false);
  assert.equal(JSON.stringify(result).includes('"text"'), false);
});
