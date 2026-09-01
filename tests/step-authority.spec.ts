import { test, expect } from "@playwright/test";
import { evaluateStepAuthority } from "../src/scenarios/step-authority";
import { extractRequirements } from "../src/scenarios/scenario-functional-quality";

const base = { configTrusted: false };

test("T1 provider-only functional action is not authoritative", () => {
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "control".' }).authorityValid).toBe(false);
});

test("T2 canonical action requirement is authoritative", () => {
  expect(evaluateStepAuthority({ ...base, step: "1. click", requirement: { id: "r1", category: "action" }, requirementFacet: "action", branchId: "b1", claimType: "action" }).authorityValid).toBe(true);
});

test("T3 destination requirement remains semantic", () => {
  const result = evaluateStepAuthority({ ...base, step: "1. Validar el destino semantico.", requirement: { id: "r1", category: "destination" }, branchId: "b1", claimType: "semantic_destination_assertion" });
  expect(result.claimType).toBe("semantic_destination_assertion");
  expect(result.authorityValid).toBe(true);
});

test("T4 destination requirement does not authorize a click", () => {
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "destino".', requirement: { id: "r1", category: "destination" }, branchId: "b1" }).authorityValid).toBe(false);
});

test("T1 canonical extraction represents visibility", () => {
  const requirements = extractRequirements("La pantalla debe mostrar un elemento visible.", []);
  expect(requirements.some((requirement) => requirement.category === "visibility")).toBe(true);
});

test("T2/T3 branch extraction exposes activation and destination facets", () => {
  const branch = {
    branchId: "branch-alpha",
    sourceLabel: "Alpha",
    sourceRequirementId: "option-alpha",
    actionIntent: "select_option",
    expectedDestination: "Beta",
    accessIntent: "public" as const,
    evidenceSource: "user_story" as const,
    activation: { actionType: "select" as const, targetIdentity: "Alpha" },
    destination: { semanticDeclaration: "Beta" },
  };
  expect(branch.activation.actionType).toBe("select");
  expect(branch.destination.semanticDeclaration).toBe("Beta");
  const [requirement] = extractRequirements("", [branch]);
  expect(requirement.facets).toEqual(["activation", "destination"]);
});

test("T4 branch activation facet authorizes action", () => {
  expect(evaluateStepAuthority({ ...base, step: "1. action", requirement: { id: "r1", category: "branch", facets: ["activation", "destination"] }, requirementFacet: "activation", branchId: "b1", claimType: "action" }).authorityValid).toBe(true);
});

test("T5 branch destination facet authorizes semantic assertion", () => {
  expect(evaluateStepAuthority({ ...base, step: "1. destination", requirement: { id: "r1", category: "branch", facets: ["activation", "destination"] }, requirementFacet: "destination", branchId: "b1", claimType: "semantic_destination_assertion" }).authorityValid).toBe(true);
});

test("T6 exact UI assertion is not a semantic destination claim", () => {
  expect(evaluateStepAuthority({ ...base, step: "1. visible", requirement: { id: "r1", category: "branch" }, requirementFacet: "destination", branchId: "b1", claimType: "visibility_assertion" }).authorityValid).toBe(false);
});

test("T7 visibility requirement does not authorize a click", () => {
  expect(evaluateStepAuthority({ ...base, step: "1. click", requirement: { id: "r1", category: "visibility" }, branchId: "b1", claimType: "action" }).authorityValid).toBe(false);
});

test("T8 action requirement does not authorize a visibility assertion", () => {
  expect(evaluateStepAuthority({ ...base, step: "1. visible", requirement: { id: "r1", category: "action" }, branchId: "b1", claimType: "visibility_assertion" }).authorityValid).toBe(false);
});

test("T5 declared route seed is not authoritative", () => {
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "seed".', configuredControls: ["seed"] }).authorityValid).toBe(false);
});

test("T6 validated route can authorize a compatible control", () => {
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "route".', validatedRouteControls: ["route"] }).sourceType).toBe("trusted_route");
});

test("T7 canonical branch authority is isolated", () => {
  expect(evaluateStepAuthority({ ...base, step: "1. click", requirement: { id: "r1", category: "action", associatedBranchId: "b1" }, branchId: "b2" }).authorityValid).toBe(false);
});

test("T8 explicit config is field-scoped", () => {
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "configured".', configTrusted: true, configuredControls: ["configured"] }).authorityValid).toBe(true);
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "other".', configTrusted: true, configuredControls: ["configured"] }).authorityValid).toBe(false);
});

test("T9 technical-only knowledge cannot authorize a claim", () => {
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "known".', knowledgeTrust: "technical" }).authorityValid).toBe(false);
});

test("T10 validated semantic knowledge can authorize a claim", () => {
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "known".', knowledgeTrust: "semantic", claimType: "action" }).sourceType).toBe("validated_knowledge");
});

test("T11 unsupported functional claim is invalid", () => {
  expect(evaluateStepAuthority({ ...base, step: '1. Clic en "unsupported".' }).authorityValid).toBe(false);
});
