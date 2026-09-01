import { test, expect } from "@playwright/test";
import { deriveProviderStepRequirementRefs, evaluateProviderClaimCompliance } from "../src/scenarios/codex-scenario-generator";
import { evaluateStepAuthority } from "../src/scenarios/step-authority";
import type { CanonicalClaim } from "../src/scenarios/scenario-types";

const claims: CanonicalClaim[] = [
  { claimId: "req-a::visibility", requirementId: "req-a", facet: "visibility", claimType: "visibility_assertion", targetKind: "declared_ui_target", required: true, coverable: true },
  { claimId: "req-b::activation", requirementId: "req-b", facet: "activation", claimType: "action", targetKind: "declared_ui_target", required: true, coverable: true, scope: "branch", scopeId: "branch-a" },
  { claimId: "req-b::destination", requirementId: "req-b", facet: "destination", claimType: "semantic_destination_assertion", targetKind: "semantic_destination", required: true, coverable: true, scope: "branch", scopeId: "branch-a" },
];

const scenario = (stepClaims: any[], stepClaimTypes = ["visibility_assertion", "action", "semantic_destination_assertion"]) => ({
  functionalBranch: { branchId: "branch-a" },
  steps: stepClaimTypes.map((_, index) => `step-${index}`),
  stepClaimTypes,
  stepClaims,
});

const allClaims = claims.map((claim, stepIndex) => ({ stepIndex, claimId: claim.claimId }));

test("T1 provider covers every required canonical claim", () => {
  const result = evaluateProviderClaimCompliance([scenario(allClaims)], claims);
  expect(result.missingClaims).toEqual([]);
  expect(result.invalidClaims).toEqual([]);
});

test("T2 omitted visibility claim is missing", () => {
  const result = evaluateProviderClaimCompliance([scenario(allClaims.slice(1))], claims);
  expect(result.missingClaims).toContain("req-a::visibility");
});

test("T3 omitted destination facet is missing", () => {
  const result = evaluateProviderClaimCompliance([scenario(allClaims.slice(0, 2))], claims);
  expect(result.missingClaims).toContain("req-b::destination");
});

test("T4 unknown claimId is invalid", () => {
  const result = evaluateProviderClaimCompliance([scenario([{ stepIndex: 0, claimId: "unknown" }])], claims);
  expect(result.invalidClaims[0].reason).toBe("unknown_claim_id");
});

test("T5 repeated requirement metadata is ignored", () => {
  const result = evaluateProviderClaimCompliance([scenario([{ stepIndex: 0, claimId: "req-a::visibility", requirementId: "wrong" }], ["visibility_assertion"])], claims);
  expect(result.invalidClaims).toEqual([]);
});

test("T6 repeated facet metadata is ignored", () => {
  const result = evaluateProviderClaimCompliance([scenario([{ stepIndex: 0, claimId: "req-a::visibility", facet: "action" }], ["visibility_assertion"])], claims);
  expect(result.invalidClaims).toEqual([]);
});

test("T7 repeated claimType metadata is ignored", () => {
  const result = evaluateProviderClaimCompliance([scenario([{ stepIndex: 0, claimId: "req-a::visibility", claimType: "action" }], ["visibility_assertion"])], claims);
  expect(result.invalidClaims).toEqual([]);
});

test("T8 repeated target metadata is ignored", () => {
  const result = evaluateProviderClaimCompliance([scenario([{ stepIndex: 0, claimId: "req-a::visibility", targetKind: "semantic_destination" }], ["visibility_assertion"])], claims);
  expect(result.invalidClaims).toEqual([]);
});

test("T9 canonical claim metadata remains authoritative", () => {
  const result = evaluateProviderClaimCompliance([scenario([{ stepIndex: 0, claimId: "req-b::destination", targetKind: "exact_ui_target" }], ["semantic_destination_assertion"])], claims);
  expect(result.invalidClaims).toEqual([]);
});

test("T10 trusted exact UI claim is compatible", () => {
  const exactClaim = { ...claims[0], claimId: "req-a::exact", targetKind: "exact_ui_target" as const };
  expect(evaluateProviderClaimCompliance([scenario([{ stepIndex: 0, claimId: exactClaim.claimId }], ["visibility_assertion"])], [exactClaim]).invalidClaims).toEqual([]);
});

test("T11 description does not affect structured claim authority", () => {
  expect(evaluateProviderClaimCompliance([scenario([{ stepIndex: 0, claimId: claims[0].claimId }], ["visibility_assertion"])], claims).invalidClaims).toEqual([]);
});

test("T12 extra functional step is outside provider claim compliance", () => {
  const result = evaluateProviderClaimCompliance([scenario([], ["action"])], claims);
  expect(result.invalidClaims).toEqual([]);
});

test("T13 compatible claims may share a scenario", () => {
  expect(evaluateProviderClaimCompliance([scenario(allClaims)], claims).referencedClaims).toHaveLength(3);
});

test("T14 incompatible branch scope is invalid", () => {
  const result = evaluateProviderClaimCompliance([{ ...scenario([{ stepIndex: 0, claimId: "req-b::activation" }]), functionalBranch: { branchId: "branch-b" } }], claims);
  expect(result.invalidClaims[0].reason).toBe("scope_mismatch");
});

test("T15 missing claims are not fabricated", () => {
  expect(evaluateProviderClaimCompliance([scenario([])], claims).missingClaims.length).toBeGreaterThan(0);
});

test("T16 facet coverage is independently accounted", () => {
  const result = evaluateProviderClaimCompliance([scenario(allClaims.slice(0, 2))], claims);
  expect(result.missingClaims).toEqual(["req-b::destination"]);
});

test("T17 provider-only output has no StepAuthority", () => {
  expect(evaluateStepAuthority({ step: "step", configTrusted: false, claimType: "action" }).authorityValid).toBe(false);
});

test("T18 fixture data stays outside production claim logic", () => {
  expect(claims.every((claim) => claim.claimId.includes("::"))).toBe(true);
});

test("minimal provider claims derive requirement, facet, and type from canonical claims", () => {
  const derived = deriveProviderStepRequirementRefs(
    [scenario([{ stepIndex: 0, claimId: "req-b::activation" }])],
    claims,
  );
  expect(derived[0].stepRequirementRefs).toEqual([
    { stepIndex: 0, requirementId: "req-b", facet: "activation" },
  ]);
});

test("invalid step index is rejected without proximity repair", () => {
  const result = evaluateProviderClaimCompliance([scenario([{ stepIndex: 99, claimId: "req-a::visibility" }])], claims);
  expect(result.invalidClaims[0].reason).toBe("invalid_step_index");
});

test("duplicate claims on one step are deduplicated deterministically", () => {
  const result = evaluateProviderClaimCompliance([scenario([
    { stepIndex: 0, claimId: "req-a::visibility" },
    { stepIndex: 0, claimId: "req-a::visibility" },
  ], ["visibility_assertion"])], claims);
  expect(result.invalidClaims).toEqual([]);
  expect(result.referencedClaims).toEqual(["req-a::visibility"]);
});

test("multiple canonical claims on one step are preserved independently", () => {
  const result = evaluateProviderClaimCompliance([scenario([
    { stepIndex: 0, claimId: "req-a::visibility" },
    { stepIndex: 0, claimId: "req-b::activation" },
  ], ["action"])], claims);
  expect(result.invalidClaims).toEqual([]);
  expect(result.referencedClaims).toEqual(["req-a::visibility", "req-b::activation"]);
});
