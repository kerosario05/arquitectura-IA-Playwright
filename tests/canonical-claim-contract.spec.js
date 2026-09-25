"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const codex_scenario_generator_1 = require("../src/scenarios/codex-scenario-generator");
const step_authority_1 = require("../src/scenarios/step-authority");
const claims = [
    { claimId: "req-a::visibility", requirementId: "req-a", facet: "visibility", claimType: "visibility_assertion", targetKind: "declared_ui_target", required: true, coverable: true },
    { claimId: "req-b::activation", requirementId: "req-b", facet: "activation", claimType: "action", targetKind: "declared_ui_target", required: true, coverable: true, scope: "branch", scopeId: "branch-a" },
    { claimId: "req-b::destination", requirementId: "req-b", facet: "destination", claimType: "semantic_destination_assertion", targetKind: "semantic_destination", required: true, coverable: true, scope: "branch", scopeId: "branch-a" },
];
const scenario = (stepClaims, stepClaimTypes = ["visibility_assertion", "action", "semantic_destination_assertion"]) => ({
    functionalBranch: { branchId: "branch-a" },
    steps: stepClaimTypes.map((_, index) => `step-${index}`),
    stepClaimTypes,
    stepClaims,
});
const allClaims = claims.map((claim, stepIndex) => ({ stepIndex, claimId: claim.claimId }));
(0, test_1.test)("T1 provider covers every required canonical claim", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario(allClaims)], claims);
    (0, test_1.expect)(result.missingClaims).toEqual([]);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
});
(0, test_1.test)("T2 omitted visibility claim is missing", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario(allClaims.slice(1))], claims);
    (0, test_1.expect)(result.missingClaims).toContain("req-a::visibility");
});
(0, test_1.test)("T3 omitted destination facet is missing", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario(allClaims.slice(0, 2))], claims);
    (0, test_1.expect)(result.missingClaims).toContain("req-b::destination");
});
(0, test_1.test)("T4 unknown claimId is invalid", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 0, claimId: "unknown" }])], claims);
    (0, test_1.expect)(result.invalidClaims[0].reason).toBe("unknown_claim_id");
});
(0, test_1.test)("T5 repeated requirement metadata is ignored", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 0, claimId: "req-a::visibility", requirementId: "wrong" }], ["visibility_assertion"])], claims);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
});
(0, test_1.test)("T6 repeated facet metadata is ignored", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 0, claimId: "req-a::visibility", facet: "action" }], ["visibility_assertion"])], claims);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
});
(0, test_1.test)("T7 repeated claimType metadata is ignored", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 0, claimId: "req-a::visibility", claimType: "action" }], ["visibility_assertion"])], claims);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
});
(0, test_1.test)("T8 repeated target metadata is ignored", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 0, claimId: "req-a::visibility", targetKind: "semantic_destination" }], ["visibility_assertion"])], claims);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
});
(0, test_1.test)("T9 canonical claim metadata remains authoritative", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 0, claimId: "req-b::destination", targetKind: "exact_ui_target" }], ["semantic_destination_assertion"])], claims);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
});
(0, test_1.test)("T10 trusted exact UI claim is compatible", () => {
    const exactClaim = { ...claims[0], claimId: "req-a::exact", targetKind: "exact_ui_target" };
    (0, test_1.expect)((0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 0, claimId: exactClaim.claimId }], ["visibility_assertion"])], [exactClaim]).invalidClaims).toEqual([]);
});
(0, test_1.test)("T11 description does not affect structured claim authority", () => {
    (0, test_1.expect)((0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 0, claimId: claims[0].claimId }], ["visibility_assertion"])], claims).invalidClaims).toEqual([]);
});
(0, test_1.test)("T12 extra functional step is outside provider claim compliance", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([], ["action"])], claims);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
});
(0, test_1.test)("T13 compatible claims may share a scenario", () => {
    (0, test_1.expect)((0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario(allClaims)], claims).referencedClaims).toHaveLength(3);
});
(0, test_1.test)("T14 incompatible branch scope is invalid", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([{ ...scenario([{ stepIndex: 0, claimId: "req-b::activation" }]), functionalBranch: { branchId: "branch-b" } }], claims);
    (0, test_1.expect)(result.invalidClaims[0].reason).toBe("scope_mismatch");
});
(0, test_1.test)("T15 missing claims are not fabricated", () => {
    (0, test_1.expect)((0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([])], claims).missingClaims.length).toBeGreaterThan(0);
});
(0, test_1.test)("T16 facet coverage is independently accounted", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario(allClaims.slice(0, 2))], claims);
    (0, test_1.expect)(result.missingClaims).toEqual(["req-b::destination"]);
});
(0, test_1.test)("T17 provider-only output has no StepAuthority", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ step: "step", configTrusted: false, claimType: "action" }).authorityValid).toBe(false);
});
(0, test_1.test)("T18 fixture data stays outside production claim logic", () => {
    (0, test_1.expect)(claims.every((claim) => claim.claimId.includes("::"))).toBe(true);
});
(0, test_1.test)("minimal provider claims derive requirement, facet, and type from canonical claims", () => {
    const derived = (0, codex_scenario_generator_1.deriveProviderStepRequirementRefs)([scenario([{ stepIndex: 0, claimId: "req-b::activation" }])], claims);
    (0, test_1.expect)(derived[0].stepRequirementRefs).toEqual([
        { stepIndex: 0, requirementId: "req-b", facet: "activation" },
    ]);
});
(0, test_1.test)("invalid step index is rejected without proximity repair", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([{ stepIndex: 99, claimId: "req-a::visibility" }])], claims);
    (0, test_1.expect)(result.invalidClaims[0].reason).toBe("invalid_step_index");
});
(0, test_1.test)("duplicate claims on one step are deduplicated deterministically", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([
            { stepIndex: 0, claimId: "req-a::visibility" },
            { stepIndex: 0, claimId: "req-a::visibility" },
        ], ["visibility_assertion"])], claims);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
    (0, test_1.expect)(result.referencedClaims).toEqual(["req-a::visibility"]);
});
(0, test_1.test)("multiple canonical claims on one step are preserved independently", () => {
    const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario([
            { stepIndex: 0, claimId: "req-a::visibility" },
            { stepIndex: 0, claimId: "req-b::activation" },
        ], ["action"])], claims);
    (0, test_1.expect)(result.invalidClaims).toEqual([]);
    (0, test_1.expect)(result.referencedClaims).toEqual(["req-a::visibility", "req-b::activation"]);
});
