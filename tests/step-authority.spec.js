"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const step_authority_1 = require("../src/scenarios/step-authority");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
const base = { configTrusted: false };
(0, test_1.test)("T1 provider-only functional action is not authoritative", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "control".' }).authorityValid).toBe(false);
});
(0, test_1.test)("T2 canonical action requirement is authoritative", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: "1. click", requirement: { id: "r1", category: "action" }, requirementFacet: "action", branchId: "b1", claimType: "action" }).authorityValid).toBe(true);
});
(0, test_1.test)("T3 destination requirement remains semantic", () => {
    const result = (0, step_authority_1.evaluateStepAuthority)({ ...base, step: "1. Validar el destino semantico.", requirement: { id: "r1", category: "destination" }, branchId: "b1", claimType: "semantic_destination_assertion" });
    (0, test_1.expect)(result.claimType).toBe("semantic_destination_assertion");
    (0, test_1.expect)(result.authorityValid).toBe(true);
});
(0, test_1.test)("T4 destination requirement does not authorize a click", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "destino".', requirement: { id: "r1", category: "destination" }, branchId: "b1" }).authorityValid).toBe(false);
});
(0, test_1.test)("T1 canonical extraction represents visibility", () => {
    const requirements = (0, scenario_functional_quality_1.extractRequirements)("La pantalla debe mostrar un elemento visible.", []);
    (0, test_1.expect)(requirements.some((requirement) => requirement.category === "visibility")).toBe(true);
});
(0, test_1.test)("T2/T3 branch extraction exposes activation and destination facets", () => {
    const branch = {
        branchId: "branch-alpha",
        sourceLabel: "Alpha",
        sourceRequirementId: "option-alpha",
        actionIntent: "select_option",
        expectedDestination: "Beta",
        accessIntent: "public",
        evidenceSource: "user_story",
        activation: { actionType: "select", targetIdentity: "Alpha" },
        destination: { semanticDeclaration: "Beta" },
    };
    (0, test_1.expect)(branch.activation.actionType).toBe("select");
    (0, test_1.expect)(branch.destination.semanticDeclaration).toBe("Beta");
    const [requirement] = (0, scenario_functional_quality_1.extractRequirements)("", [branch]);
    (0, test_1.expect)(requirement.facets).toEqual(["activation", "destination"]);
});
(0, test_1.test)("T4 branch activation facet authorizes action", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: "1. action", requirement: { id: "r1", category: "branch", facets: ["activation", "destination"] }, requirementFacet: "activation", branchId: "b1", claimType: "action" }).authorityValid).toBe(true);
});
(0, test_1.test)("T5 branch destination facet authorizes semantic assertion", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: "1. destination", requirement: { id: "r1", category: "branch", facets: ["activation", "destination"] }, requirementFacet: "destination", branchId: "b1", claimType: "semantic_destination_assertion" }).authorityValid).toBe(true);
});
(0, test_1.test)("T6 exact UI assertion is not a semantic destination claim", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: "1. visible", requirement: { id: "r1", category: "branch" }, requirementFacet: "destination", branchId: "b1", claimType: "visibility_assertion" }).authorityValid).toBe(false);
});
(0, test_1.test)("T7 visibility requirement does not authorize a click", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: "1. click", requirement: { id: "r1", category: "visibility" }, branchId: "b1", claimType: "action" }).authorityValid).toBe(false);
});
(0, test_1.test)("T8 action requirement does not authorize a visibility assertion", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: "1. visible", requirement: { id: "r1", category: "action" }, branchId: "b1", claimType: "visibility_assertion" }).authorityValid).toBe(false);
});
(0, test_1.test)("T5 declared route seed is not authoritative", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "seed".', configuredControls: ["seed"] }).authorityValid).toBe(false);
});
(0, test_1.test)("T6 validated route can authorize a compatible control", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "route".', validatedRouteControls: ["route"] }).sourceType).toBe("trusted_route");
});
(0, test_1.test)("T7 canonical branch authority is isolated", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: "1. click", requirement: { id: "r1", category: "action", associatedBranchId: "b1" }, branchId: "b2" }).authorityValid).toBe(false);
});
(0, test_1.test)("T8 explicit config is field-scoped", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "configured".', configTrusted: true, configuredControls: ["configured"] }).authorityValid).toBe(true);
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "other".', configTrusted: true, configuredControls: ["configured"] }).authorityValid).toBe(false);
});
(0, test_1.test)("T9 technical-only knowledge cannot authorize a claim", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "known".', knowledgeTrust: "technical" }).authorityValid).toBe(false);
});
(0, test_1.test)("T10 validated semantic knowledge can authorize a claim", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "known".', knowledgeTrust: "semantic", claimType: "action" }).sourceType).toBe("validated_knowledge");
});
(0, test_1.test)("T11 unsupported functional claim is invalid", () => {
    (0, test_1.expect)((0, step_authority_1.evaluateStepAuthority)({ ...base, step: '1. Clic en "unsupported".' }).authorityValid).toBe(false);
});
