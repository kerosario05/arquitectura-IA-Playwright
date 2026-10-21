import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { buildPromotionSourceScenario } from "./case-discovery-workflow";
import { buildSpecExecutionContract } from "../automations/spec-execution-contract";
import { compileDeterministicSpec } from "../automations/spec-compiler/deterministic-spec-compiler";
import type { TestScenario } from "../types/testrail.types";
import type { CaseDiscoveryResult } from "../types/discovery.types";

test("toggle and unnamed option retain separate recording ownership through spec compilation", () => {
 for (const [toggle, option] of [["Consent", "Choice A"], ["Notifications", "Warehouse B"]]) {
  const checkRef = `role:checkbox|${toggle}`, optionRef = `role:option|${option}`;
  const scenario = { source: "manual", title: "Fixture", externalId: "fixture", steps: [
   { index: 1, action: `Marcar "${toggle}"`, dataHints: [], controlIdentity: "check-owner", recordingActionType: "check" },
   { index: 2, action: "Presionar el control grabado", dataHints: [], controlIdentity: "option-owner", recordingActionType: "click" },
  ], recordingExecutionContract: { actions: [
   { actionType: "check", humanStep: `Marcar "${toggle}"`, semanticField: "control", controlIdentity: "check-owner", technicalTargetRef: checkRef, technicalTargetRefs: [checkRef] },
   { actionType: "click", humanStep: "Presionar el control grabado", semanticField: option, controlIdentity: "option-owner", technicalTargetRef: optionRef, technicalTargetRefs: [optionRef] },
  ] } } as unknown as TestScenario;
  const plan = { version: "1.0", source: "discovery_generated", status: "validated", createdAt: new Date().toISOString(),
   scenario: { source: "manual", title: "Fixture", externalId: "fixture" }, requiredData: [], steps: [
    { index: 1, action: "click", description: `Marcar "${toggle}"`, target: { strategy: "role", value: `checkbox|${toggle}` } },
    { index: 2, action: "click", description: "Presionar el control grabado", target: { strategy: "role", value: `option|${option}` } },
   ] } as any;
  const result = { version: "1.0", caseId: 0, caseTitle: "Fixture", discoveredAt: new Date().toISOString(), status: "discovered_passed", steps: [], discoveredObjects: [], candidatePlan: plan } as CaseDiscoveryResult;
  const source = buildPromotionSourceScenario(scenario, result);
  assert.equal(source.steps?.[0].technicalTargetRef, checkRef);
  assert.equal(source.steps?.[1].technicalTargetRef, optionRef);
  const contract = buildSpecExecutionContract(plan, source);
  assert.equal(contract.steps.find(step => step.scenarioStepIndex === 2)?.technicalTargetRef, optionRef);
  const compiled = compileDeterministicSpec(contract, { targetSpecPath: path.resolve(".artifacts/tmp/ownership.spec.ts") });
  const optionBinding = compiled.bindings.find(binding => binding.scenarioStepIndex === 2);
  assert.equal(optionBinding?.targetRef, optionRef);
 }
});

test("repeated exact steps keep recording occurrence order when projected control identities are stale", () => {
 const firstRef = 'css:[id="btn-identity-validate"]';
 const secondRef = 'css:[id="btn-identity-confirm-and-continue"]';
 const repeatedStep = 'Presionar "Continuar"';
 const scenario = { source: "manual", title: "Repeated buttons", externalId: "repeated-buttons", steps: [
  { index: 1, action: repeatedStep, dataHints: [], controlIdentity: "later-button" },
  { index: 2, action: repeatedStep, dataHints: [], controlIdentity: "earlier-button" },
 ], recordingExecutionContract: { actions: [
  { actionType: "click", humanStep: repeatedStep, controlIdentity: "earlier-button", technicalTargetRef: firstRef, technicalTargetRefs: [firstRef] },
  { actionType: "click", humanStep: repeatedStep, controlIdentity: "later-button", technicalTargetRef: secondRef, technicalTargetRefs: [secondRef] },
 ] } } as unknown as TestScenario;
 const plan = { version: "1.0", source: "discovery_generated", status: "validated", createdAt: new Date().toISOString(),
  scenario: { source: "manual", title: "Repeated buttons", externalId: "repeated-buttons" }, requiredData: [], steps: [
   { index: 1, action: "click", description: repeatedStep, target: { strategy: "role", value: "button|Continuar" } },
   { index: 2, action: "click", description: repeatedStep, target: { strategy: "role", value: "button|Continuar" } },
  ] } as any;
 const result = { version: "1.0", caseId: 0, caseTitle: "Repeated buttons", discoveredAt: new Date().toISOString(), status: "discovered_passed", steps: [], discoveredObjects: [], candidatePlan: plan } as CaseDiscoveryResult;
 const source = buildPromotionSourceScenario(scenario, result);
 assert.equal(source.steps?.[0].technicalTargetRef, firstRef);
 assert.equal(source.steps?.[1].technicalTargetRef, secondRef);
 const contract = buildSpecExecutionContract(plan, source);
 assert.deepEqual(contract.steps.map(step => step.technicalTargetRef), [firstRef, secondRef]);
 const compiled = compileDeterministicSpec(contract, { targetSpecPath: path.resolve(".artifacts/tmp/repeated-buttons.spec.ts") });
 assert.deepEqual(compiled.bindings.map(binding => binding.targetRef), [firstRef, secondRef]);
});
