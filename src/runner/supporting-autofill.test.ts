import assert from "node:assert/strict";
import test from "node:test";
import { resolveSupportingAutofill } from "./supporting-autofill";
import { buildRuntimeControlIdentity } from "../types/control-identity";

const identity = (name: string, role = "textbox") => buildRuntimeControlIdentity({
  tagName: role === "listbox" ? "div" : "input",
  inputType: role === "textbox" ? "email" : undefined,
  role,
  name,
  candidateLocator: { strategy: "role", role },
});

const requirement = (key: string, valuePolicy: "scenario_controlled" | "safe_synthetic" | "trusted_required" | "unresolved", kind: string) => ({
  key, source: "contract" as const, valuePolicy, fieldCapability: { kind } as any,
});

const control = (requirementRef: string, controlIdentity: ReturnType<typeof identity>, overrides: Record<string, unknown> = {}) => ({
  requirementRef, visible: true, disabled: false, required: true, value: "", controlIdentity, ...overrides,
});

test("fills only the auxiliary safe synthetic control and retries the causal action once", async () => {
  const functionalIdentity = identity("functional")!;
  const auxiliaryIdentity = identity("auxiliary")!;
  const filled: string[] = [];
  let retries = 0;
  const locators = new Map([
    [auxiliaryIdentity.fingerprint, { fill: async (value: string) => filled.push(value) }],
    [functionalIdentity.fingerprint, { fill: async () => filled.push("functional") }],
  ]);
  const result = await resolveSupportingAutofill({
    page: {} as any,
    executionPlan: [{ index: 1, action: "fill", controlIdentity: functionalIdentity, valueKey: "functional", requirementRefs: ["functional"] }],
    runtimeRequirements: [requirement("functional", "scenario_controlled", "text"), requirement("auxiliary", "safe_synthetic", "email")],
    observedControls: [
      control("functional", functionalIdentity),
      control("auxiliary", auxiliaryIdentity),
      control("auxiliary", auxiliaryIdentity),
    ].map((item) => ({ ...item, locator: locators.get(item.controlIdentity!.fingerprint)! as any })),
    dependentAction: { causal: true },
    executionSeed: "run-seed",
    retryDependentAction: async () => { retries += 1; },
  });
  assert.equal(result.retryAttempted, true);
  assert.equal(retries, 1);
  assert.equal(filled.length, 1);
  assert.match(filled[0]!, /@example\.test$/);
  assert.equal(result.resolutions.filter((item) => item.decision === "supporting_candidate").length, 1);
});

test("does not modify protected, trusted, unresolved, complete, or non-causal controls", async () => {
  const protectedIdentity = identity("protected")!;
  const trustedIdentity = identity("trusted")!;
  const unresolvedIdentity = identity("unresolved")!;
  const completeIdentity = identity("complete")!;
  const calls: string[] = [];
  const observedControls = [
    control("protected", protectedIdentity),
    control("trusted", trustedIdentity),
    control("unresolved", null, { controlIdentity: null }),
    control("complete", completeIdentity, { value: "present" }),
  ].map((item) => ({ ...item, locator: { fill: async () => { calls.push(item.requirementRef); } } as any }));
  const result = await resolveSupportingAutofill({
    page: {} as any,
    executionPlan: [{ index: 1, action: "fill", controlIdentity: protectedIdentity, inputIntent: { mode: "leave_unset" }, requirementRefs: ["protected"] }],
    runtimeRequirements: [
      requirement("protected", "safe_synthetic", "email"),
      requirement("trusted", "trusted_required", "password"),
      requirement("unresolved", "unresolved", "unknown"),
      requirement("complete", "safe_synthetic", "email"),
    ],
    observedControls,
    dependentAction: { causal: false },
    executionSeed: "run-seed",
    retryDependentAction: async () => { calls.push("retry"); },
  });
  assert.equal(calls.length, 0);
  assert.equal(result.retryAttempted, false);
  assert.equal(result.resolutions.find((item) => item.requirementRef === "protected")?.decision, "protected_intent");
  assert.equal(result.resolutions.find((item) => item.requirementRef === "trusted")?.decision, "trusted_required");
  assert.equal(result.resolutions.find((item) => item.requirementRef === "complete")?.decision, "already_satisfied");
  for (const mode of ["invalid_value", "preserve_state"] as const) {
    const modeIdentity = identity(mode)!;
    const protectedResult = await resolveSupportingAutofill({
      page: {} as any,
      executionPlan: [{ index: 1, action: "fill", controlIdentity: modeIdentity, inputIntent: { mode }, requirementRefs: [mode] }],
      runtimeRequirements: [requirement(mode, "safe_synthetic", "email")],
      observedControls: [{ ...control(mode, modeIdentity), locator: { fill: async () => { calls.push(mode); } } as any }],
      dependentAction: { causal: true },
      executionSeed: "run-seed",
    });
    assert.equal(protectedResult.resolutions[0]?.decision, "protected_intent");
  }
});

test("uses the existing runtime select strategy without materializing options", async () => {
  const selectIdentity = identity("dynamic", "listbox")!;
  let selected = "";
  const locator = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "select", required: true, disabled: false, native: true, options: [{ value: "runtime-option", disabled: false, selected: false }] }),
    selectOption: async (value: string) => { selected = value; },
  };
  const result = await resolveSupportingAutofill({
    page: {} as any,
    executionPlan: [],
    runtimeRequirements: [requirement("dynamic", "safe_synthetic", "select")],
    observedControls: [{ ...control("dynamic", selectIdentity), locator: locator as any }],
    dependentAction: { causal: true },
    executionSeed: "run-seed",
  });
  assert.equal(selected, "runtime-option");
  assert.equal(result.resolutions[0]?.source, "runtime_strategy");
  assert.equal(JSON.stringify(result).includes("runtime-option"), false);
});
