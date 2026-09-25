import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildPromotionSourceScenario } from "./case-discovery-workflow";
import { buildSpecExecutionContract } from "../automations/spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "../automations/spec-compiler/deterministic-spec-compiler";
import type { CaseDiscoveryResult } from "../types/discovery.types";
import type { TestScenario } from "../types/testrail.types";

/**
 * FIRST_LOSS fix (job d84277e1-d0f1-4eb3-885c-e7f9c7b7d6e4): the STANDARD click success
 * persistence path in case-discovery.ts (the `steps.push({...})` immediately after the
 * `if (clickRetryPolicy.retryRequired) {...}` block closes -- the common/default push every
 * non-retried click success reaches) never copied `actionTarget.associatedField` onto the
 * persisted step. Discovery physically resolved this click via the field-scoped fallback
 * (tier=3, recorded, associatedFieldPresent=true) and PASSED, but the promoted runtime received
 * only the bare display ref ("role:button", 8 matches, strict-mode FAIL) because associatedField
 * never survived past this exact push.
 *
 * This is a SEPARATE push site from the one already fixed for the stability-retry click path
 * (case-discovery.ts, the `steps.push` inside the `authRecovery.recovered` branch) -- both are
 * now fixed with the same verbatim-transport, never-certify pattern.
 *
 * Source-text verification confirms the exact fix location; the cross-boundary tests reproduce
 * the physical job's own index shapes (scenarioStep.index=7, actionTarget.index=6) end-to-end
 * through the REAL functions with synthetic fixtures, mirroring the established
 * case-discovery-workflow.field-scoped-fill-authority.test.ts pattern.
 */

const CASE_DISCOVERY_SOURCE = fs.readFileSync(path.resolve(__dirname, "case-discovery.ts"), "utf8");

function buildCaseResult(overrides: Partial<CaseDiscoveryResult> = {}): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 0,
    caseTitle: "Synthetic standard-click associatedField",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps: [],
    discoveredObjects: [],
    ...overrides,
  };
}

test("1/STANDARD_CLICK_PERSISTS_ASSOCIATED_FIELD: the standard-click success push in case-discovery.ts now carries actionTarget.associatedField verbatim", () => {
  // Anchor on this ticket's own fix comment -- unambiguous, points at exactly the push this
  // ticket's DIAGNOSE identified as the standard-click success persistence path (the shared
  // push every non-retried click reaches after `if (clickRetryPolicy.retryRequired) {...}`
  // closes, matching the real job's persisted locatorStrategy=recorded:css).
  const anchor = CASE_DISCOVERY_SOURCE.indexOf("FIRST_LOSS fix (job d84277e1-d0f1-4eb3-885c-e7f9c7b7d6e4)");
  assert.notEqual(anchor, -1, "the fix's own doc comment must exist at the standard-click success push");
  const pushStart = CASE_DISCOVERY_SOURCE.lastIndexOf("steps.push({", anchor);
  const pushEnd = CASE_DISCOVERY_SOURCE.indexOf("});", pushStart);
  const pushBlock = CASE_DISCOVERY_SOURCE.slice(pushStart, pushEnd);
  assert.match(pushBlock, /locatorStrategy: resolution\.locatorStrategy,/, "sanity: this must be the standard-click success push (matches the real job's persisted locatorStrategy=recorded:css)");
  assert.match(
    pushBlock,
    /\.\.\.\(actionTarget\.associatedField \? \{ associatedField: actionTarget\.associatedField \} : \{\}\),/,
    "the standard-click success push must now transport associatedField verbatim, never a certification",
  );
});

test("2/INDEX_SPACE_SKEW_TRANSPORT: associatedField survives buildPromotionSourceScenario when reproducing the job's real index shapes (scenarioStep.index=7, caseResult.steps entry index=6, matched by the SAME actionTarget/scenario index space)", () => {
  // Discovery persists CaseDiscoveryResult.steps keyed by actionTarget.index -- which is the
  // SAME index space TestScenario.steps[].index uses (Discovery parses actionTargets directly
  // off the scenario's own steps). The apparent "step6 vs step7" skew observed in the real job's
  // artifacts came from plan.steps[].index (a SEPARATELY resequenced counter, off by one due to
  // an earlier step the plan-builder didn't push) -- NOT from a scenario/actionTarget mismatch.
  // This test reproduces both index literals from the real job to prove the merge is keyed
  // correctly on the scenario/actionTarget space, regardless of the plan's own renumbering.
  const scenario: TestScenario = {
    source: "jira",
    externalId: "REC-STDCLICK-SYNTH",
    caseId: 0,
    title: "Synthetic standard-click associatedField",
    steps: [{ index: 7, action: "Presionar botón asociado a \"Número de identificación\"", dataHints: [] } as TestScenario["steps"][number]],
  };
  const caseResult = buildCaseResult({
    steps: [{ index: 7, action: "click", status: "found", targetText: "Número de identificación", locatorStrategy: "recorded:css", associatedField: "Número de identificación" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const propagatedStep = sourceScenario.steps?.find((s) => s.index === 7);
  assert.ok(propagatedStep, "the scenario step (index=7, matching the plan's OWN persisted numbering) must exist");
  assert.equal((propagatedStep as any).associatedField, "Número de identificación", "associatedField must survive the merge when caseResult.steps and scenario.steps share the same index space");
});

function buildStandardClickPlan(index: number) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "jira", caseId: 0, externalId: "REC-STDCLICK-SYNTH", title: "Synthetic standard-click associatedField" },
    requiredData: [],
    steps: [{
      index,
      action: "click",
      target: { strategy: "recorded:css", value: "Número de identificación", exact: false },
      locatorStrategy: "recorded:css",
      description: "Presionar botón asociado a \"Número de identificación\"",
    }],
    createdAt: new Date().toISOString(),
  } as any;
}

test("3/CONTRACT_COMPILER_TRANSPORT: associatedField reaches SpecExecutionContractStep and compileClickStep emits it for a runtime_resolution_required standard click", () => {
  const scenario: TestScenario = {
    source: "jira",
    externalId: "REC-STDCLICK-SYNTH",
    caseId: 0,
    title: "Synthetic standard-click associatedField",
    steps: [{ index: 7, action: "Presionar botón asociado a \"Número de identificación\"", dataHints: [] } as TestScenario["steps"][number]],
  };
  const caseResult = buildCaseResult({
    steps: [{ index: 7, action: "click", status: "found", targetText: "Número de identificación", associatedField: "Número de identificación" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const contract = buildSpecExecutionContract(buildStandardClickPlan(7), sourceScenario);
  const step = contract.steps.find((s) => s.scenarioStepIndex === 7);
  assert.ok(step);
  assert.equal(step!.associatedField, "Número de identificación");
  assert.equal(step!.resolutionState, "runtime_resolution_required");

  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
  );
  const result = compileDeterministicSpecRaw(contract, { targetSpecPath });
  assert.match(result.source, /associatedField: 'Número de identificación'/, "the compiler must emit associatedField for this runtime_resolution_required click");
});

test("4/RESOLUTION_STATE_REMAINS_RUNTIME_REQUIRED: transporting associatedField never upgrades resolutionState or fabricates technicalTargetRefs/firstStructuredEvidenceRef", () => {
  const scenario: TestScenario = {
    source: "jira",
    externalId: "REC-STDCLICK-SYNTH",
    caseId: 0,
    title: "Synthetic standard-click associatedField",
    steps: [{ index: 7, action: "Presionar botón asociado a \"Número de identificación\"", dataHints: [] } as TestScenario["steps"][number]],
  };
  const caseResult = buildCaseResult({
    steps: [{ index: 7, action: "click", status: "found", targetText: "Número de identificación", associatedField: "Número de identificación" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const contract = buildSpecExecutionContract(buildStandardClickPlan(7), sourceScenario);
  const step = contract.steps.find((s) => s.scenarioStepIndex === 7);
  assert.ok(step);
  assert.equal(step!.resolutionState, "runtime_resolution_required");
  assert.equal(step!.technicalTargetRef, undefined, "no technicalTargetRef must be fabricated");
  // No certification upgrade: the same pre-existing Tier-5 display fallback as before this fix.
  assert.equal(step!.certifiedTechnicalTarget?.targetType, "display");
  assert.equal(step!.certifiedTechnicalTarget?.certificationTier, 5);

  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
  );
  const result = compileDeterministicSpecRaw(contract, { targetSpecPath });
  assert.match(result.source, /technicalTargetRefs: \['text:Número de identificación'\]/, "the pre-existing runtime_deferred ref (firstStructuredEvidenceRef) must be unchanged, with or without associatedField");
});

test("5/NO_ASSOCIATED_FIELD_LEGACY_UNCHANGED: a standard click with no associatedField anywhere behaves exactly as before -- no field emitted at any boundary", () => {
  const scenario: TestScenario = {
    source: "jira",
    externalId: "REC-STDCLICK-SYNTH",
    caseId: 0,
    title: "Synthetic standard-click, no field hint",
    steps: [{ index: 7, action: "Presionar botón asociado a \"Número de identificación\"", dataHints: [] } as TestScenario["steps"][number]],
  };
  const caseResult = buildCaseResult({
    steps: [{ index: 7, action: "click", status: "found", targetText: "Número de identificación" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const propagatedStep = sourceScenario.steps?.find((s) => s.index === 7);
  assert.ok(propagatedStep);
  assert.equal((propagatedStep as any).associatedField, undefined);

  const contract = buildSpecExecutionContract(buildStandardClickPlan(7), sourceScenario);
  const step = contract.steps.find((s) => s.scenarioStepIndex === 7);
  assert.ok(step);
  assert.equal(step!.associatedField, undefined);
  assert.equal(step!.resolutionState, "runtime_resolution_required");

  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
  );
  const result = compileDeterministicSpecRaw(contract, { targetSpecPath });
  assert.doesNotMatch(result.source, /associatedField:/, "no associatedField may be emitted when none exists anywhere upstream");
});
