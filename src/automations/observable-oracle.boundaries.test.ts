import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSpecExecutionContract,
  validateSpecExecutionContract,
  type ContractSourceScenario,
} from "./spec-execution-contract";
import {
  buildPromotedOracleImplementations,
  buildSemanticCoverageDiagnostics,
  runHybridSpecGeneration,
} from "./spec-generation-hybrid";
import { persistFreshPlanForExistingSpecReuse } from "./promote-plan";

function planFor(appSlug: string, caseId = 901): any {
  return {
    scenario: { caseId, externalId: `SYNTH-${caseId}`, title: "Synthetic oracle boundary" },
    appSlug,
    steps: [
      { index: 1, action: "assertVisible", expected: "document field invalid" },
      { index: 2, action: "assertUrl", expected: "forbidden destination absent" },
    ],
  };
}

function canonicalSource(oracle: Record<string, unknown>, expected: string, stepIndex: number): ContractSourceScenario {
  const requirementId = `REQ-SYNTH-${stepIndex}`;
  return {
    title: "Synthetic oracle boundary",
    steps: [{ index: stepIndex, action: stepIndex === 1 ? "Validar estado" : "Validar no avance", expected }],
    observableOracles: [{
      id: `oracle-${stepIndex}`,
      requirement: requirementId,
      source: "discovery",
      stepIndex,
      requirementRefs: [requirementId],
      evidence: [],
      ...oracle,
    } as any],
    requirements: [{ requirementId, description: expected, polarity: oracle.polarity as any }],
    stepRequirementRefs: [{ stepIndex, requirementId }],
    stepClaims: [{ stepIndex, claimId: `CLAIM-${stepIndex}`, requirementId, required: true, coverable: true }],
  };
}

test("TEST 1 invalid field state is backed, required, and promotable", () => {
  const source = canonicalSource({
    type: "runtime_state",
    backed: true,
    polarity: "positive",
    details: {
      stateKind: "field_validation",
      fieldIdentity: { role: "textbox", name: "document" },
      expectedState: "invalid",
      association: { ariaInvalid: true, describedBy: "document-error" },
    },
    evidence: ["field_state:invalid", "aria_invalid:true", "validation_association:document-error"],
  }, "document field invalid", 1);
  const contract = buildSpecExecutionContract(planFor("synthetic-a"), source, { appSlug: "synthetic-a" });
  const validation = validateSpecExecutionContract(contract);
  assert.equal(contract.steps[0]?.required, true);
  assert.equal(contract.steps[0]?.oracle?.backed, true);
  assert.equal(validation.valid, true);
  assert.equal(buildPromotedOracleImplementations(source.observableOracles as any, null).length, 1);
});

test("TEST 2 negative no-transition oracle preserves negative polarity and evidence", () => {
  const source = canonicalSource({
    type: "url_state",
    backed: true,
    polarity: "negative",
    details: { expectedUrl: "/forbidden-destination" },
    evidence: ["trigger:advance_attempt", "forbidden_transition_absent:true", "after_url:/current"],
  }, "forbidden destination absent", 2);
  const contract = buildSpecExecutionContract(planFor("synthetic-a"), source, { appSlug: "synthetic-a" });
  const implementation = buildPromotedOracleImplementations(source.observableOracles as any, null)[0];
  assert.equal(contract.steps[0]?.oracle?.backed, true);
  assert.equal(contract.steps[0]?.oracle?.polarity, "negative");
  assert.equal(implementation?.polarity, "negative");
  assert.equal(implementation?.expectedUrlPattern, "/forbidden-destination");
  assert.equal(validateSpecExecutionContract(contract).valid, true);
});

test("TEST 4 narrative without runtime evidence remains required and blocks promotion", () => {
  const source = canonicalSource({
    type: "unsupported_or_unresolved",
    backed: false,
    source: "scenario",
    evidence: ["backing_evidence_missing"],
  }, "document validation appears", 1);
  const contract = buildSpecExecutionContract(planFor("synthetic-a"), source, { appSlug: "synthetic-a" });
  assert.equal(contract.steps[0]?.required, true);
  assert.equal(Boolean(contract.steps[0]?.oracle?.backed), false);
  assert.equal(contract.steps[0]?.executionStatus, "unresolved");
  assert.equal(validateSpecExecutionContract(contract).valid, false);
});

test("TEST 5 round-trip preserves oracle identity, polarity, refs, and evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-round-trip-"));
  try {
    const planPath = path.join(root, "plan.json");
    const plan = planFor("synthetic-a");
    const source = canonicalSource({
      type: "url_state",
      backed: true,
      polarity: "negative",
      evidence: ["forbidden_transition_absent:true"],
      details: { expectedUrl: "/forbidden-destination" },
    }, "forbidden destination absent", 2);
    const contract = buildSpecExecutionContract(plan, source, { appSlug: "synthetic-a" });
    fs.writeFileSync(planPath, JSON.stringify({ ...plan, sourceScenario: source, executionContract: contract }));
    await persistFreshPlanForExistingSpecReuse({ planPath, plan, sourceScenario: source as any, executionContract: contract });
    const roundTrip = JSON.parse(fs.readFileSync(planPath, "utf8"));
    const oracle = roundTrip.sourceScenario.observableOracles[0];
    assert.equal(oracle.id, "oracle-2");
    assert.equal(oracle.polarity, "negative");
    assert.deepEqual(oracle.requirementRefs, ["REQ-SYNTH-2"]);
    assert.equal(roundTrip.executionContract.steps[0].oracle.polarity, "negative");
    assert.equal(roundTrip.executionContract.steps[0].evidenceRefs[0], "oracle:oracle-2");
    assert.equal(Object.values(roundTrip).some((value) => String(value).includes("password")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("TEST 6 the same oracle contract logic is independent across synthetic projects", () => {
  const sourceA = canonicalSource({
    type: "runtime_state",
    backed: true,
    polarity: "positive",
    evidence: ["field_state:invalid"],
  }, "document field invalid", 1);
  const sourceB = { ...sourceA, title: "Synthetic oracle boundary B" };
  const contractA = buildSpecExecutionContract(planFor("synthetic-a", 902), sourceA, { appSlug: "synthetic-a" });
  const contractB = buildSpecExecutionContract(planFor("synthetic-b", 903), sourceB, { appSlug: "synthetic-b" });
  assert.equal(contractA.steps[0]?.oracle?.type, contractB.steps[0]?.oracle?.type);
  assert.equal(contractA.steps[0]?.oracle?.backed, true);
  assert.equal(contractB.steps[0]?.oracle?.backed, true);
  assert.equal(validateSpecExecutionContract(contractA).valid, true);
  assert.equal(validateSpecExecutionContract(contractB).valid, true);
});

test("TEST 7 before-after mutation is required before promoting field validation", () => {
  const before = {
    structuralFingerprint: "screen-before",
    field: { identity: "document", invalid: false, describedBy: null },
    transition: { attempted: false, url: "/current" },
  };
  const after = {
    structuralFingerprint: "screen-after",
    field: { identity: "document", invalid: true, describedBy: "document-error" },
    transition: { attempted: true, url: "/current" },
  };

  assert.notEqual(before.structuralFingerprint, after.structuralFingerprint);
  assert.equal(before.field.invalid, false);
  assert.equal(after.field.invalid, true);
  assert.equal(after.field.describedBy, "document-error");
  assert.equal(after.transition.attempted, true);
  assert.equal(after.transition.url, before.transition.url);

  const source = canonicalSource({
    type: "runtime_state",
    backed: true,
    polarity: "positive",
    details: {
      stateKind: "before_after_mutation",
      beforeState: before,
      afterState: after,
      trigger: "advance_attempt",
    },
    evidence: [
      "before:fingerprint=screen-before",
      "after:fingerprint=screen-after",
      "after:field.invalid=true",
      "after:field.describedBy=document-error",
    ],
  }, "document field invalid", 1);
  const contract = buildSpecExecutionContract(planFor("synthetic-a"), source, { appSlug: "synthetic-a" });
  assert.equal(contract.steps[0]?.oracle?.backed, true);
  assert.deepEqual(contract.steps[0]?.evidenceRefs, ["oracle:oracle-1"]);
  assert.equal(validateSpecExecutionContract(contract).valid, true);
});

test("TEST 8 focal integration maps canonical evidence to oracle, contract, coverage, and promotion", async () => {
  const requirementOne = "document field invalid";
  const requirementTwo = "forbidden destination absent";
  const source: ContractSourceScenario = {
    title: "Synthetic focal integration",
    steps: [
      { index: 1, action: "Validar estado", expected: requirementOne },
      { index: 2, action: "Validar no avance", expected: requirementTwo },
    ],
    observableOracles: [
      {
        id: "oracle-integration-1",
        requirement: requirementOne,
        type: "runtime_state",
        backed: true,
        source: "discovery",
        stepIndex: 1,
        evidence: ["after:field.invalid=true"],
        polarity: "positive",
      },
      {
        id: "oracle-integration-2",
        requirement: requirementTwo,
        type: "url_state",
        backed: true,
        source: "discovery",
        stepIndex: 2,
        evidence: ["after:url=/current", "forbidden_transition_absent:true"],
        polarity: "negative",
        details: { expectedUrl: "/forbidden-destination" },
      },
    ],
    requirements: [
      { requirementId: requirementOne, description: requirementOne, polarity: "positive" },
      { requirementId: requirementTwo, description: requirementTwo, polarity: "negative" },
    ],
    stepRequirementRefs: [
      { stepIndex: 1, requirementId: requirementOne },
      { stepIndex: 2, requirementId: requirementTwo },
    ],
    stepClaims: [
      { stepIndex: 1, claimId: "claim-integration-1", requirementId: requirementOne, required: true, coverable: true },
      { stepIndex: 2, claimId: "claim-integration-2", requirementId: requirementTwo, required: true, coverable: true },
    ],
  };
  const plan = {
    ...planFor("synthetic-integration", 904),
    steps: [
      { index: 1, action: "assertVisible", expected: requirementOne },
      { index: 2, action: "assertUrl", expected: requirementTwo },
    ],
  };
  const contract = buildSpecExecutionContract(plan, source, { appSlug: "synthetic-integration" });
  const contractValidation = validateSpecExecutionContract(contract);
  const promoted = buildPromotedOracleImplementations(source.observableOracles, null);
  const coverage = buildSemanticCoverageDiagnostics({
    semanticErrors: [],
    requiredAssertions: [requirementOne, requirementTwo],
    observableOracles: source.observableOracles,
    scenarioSteps: source.steps ?? [],
  });

  assert.equal(contractValidation.valid, true);
  assert.equal(contract.steps.filter((step) => step.required).length, 2);
  assert.equal(promoted.length, 2);
  assert.deepEqual(promoted.map((item) => item.polarity), ["positive", "negative"]);
  assert.deepEqual(coverage.missingRequirements, []);
  assert.deepEqual(coverage.candidateCoverage.map((item) => item.implemented), [true, true]);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-integration-"));
  try {
    const appDir = path.join(root, "automations", "apps", "synthetic-integration");
    const caseDir = path.join(appDir, "sections", "synthetic", "cases", "case");
    fs.mkdirSync(caseDir, { recursive: true });
    const specPath = path.join(caseDir, "case.spec.ts");
    const deterministicDraft = [
      "import { test, expect } from '@playwright/test';",
      "import { createPromotedSpecRuntime } from 'BROKEN_RUNTIME_IMPORT';",
      "export const PROMOTED_SPEC_STRATEGY = \"pom_runtime\";",
      "test('Synthetic focal integration', async ({ page }) => {",
      "  process.env.APP_SLUG = 'synthetic-integration';",
      "  process.env.SECTION_SLUG = 'synthetic';",
      "  process.env.SCENARIO_ID = 'SYNTH-904';",
      "  process.env.SCENARIO_TITLE = 'Synthetic focal integration';",
      "  const promotedRuntime = createPromotedSpecRuntime(page);",
      "  try {",
      "    await promotedRuntime.expectPromotedVisible({ stepIndex: 1, target: 'document field invalid', polarity: 'positive', assertion: async () => { await expect(page.locator('body')).toBeVisible(); } });",
      "    await promotedRuntime.expectPromotedVisible({ stepIndex: 2, target: 'forbidden destination absent', polarity: 'negative', expectedUrl: '/forbidden-destination', assertion: async () => { await expect(page.locator('body')).toBeVisible(); } });",
      "  } finally {",
      "    await promotedRuntime.finishEvidence();",
      "  }",
      "});",
    ].join("\n");
    const aiEnvironmentKeys = [
      "AI_ENABLED",
      "AI_SPEC_GENERATION_ENABLED",
      "AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED",
    ];
    const previousAiEnvironment = Object.fromEntries(aiEnvironmentKeys.map((key) => [key, process.env[key]]));
    let generation;
    try {
      for (const key of aiEnvironmentKeys) process.env[key] = "false";
      generation = await runHybridSpecGeneration({
        plan,
        deterministicDraft,
        appProfile: {
          appSlug: "synthetic-integration",
          source: "default",
          createdAt: "",
          updatedAt: "",
        },
        appPaths: {
          appDir,
          configPath: path.join(appDir, "app.config.json"),
          caseDir,
          specPath,
        } as any,
        sectionSlug: "synthetic",
        scenarioId: "SYNTH-904",
        sourceScenario: source,
        executionSource: "synthetic-boundary-test",
      }, {
        runTypeScriptValidation: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        runPlaywrightDiscovery: async () => ({ ok: true, stdout: "Total: 1 test in 1 file", stderr: "", exitCode: 0 }),
      });
    } finally {
      for (const [key, value] of Object.entries(previousAiEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    assert.equal(generation.promotionAllowed, true);
    assert.equal(generation.diagnostics.validation.structure, "passed");
    assert.equal(generation.diagnostics.validation.semanticCoverage, "passed");
    assert.equal(generation.diagnostics.validation.typescript, "passed");
    assert.equal(generation.diagnostics.validation.playwrightDiscovery, "passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
