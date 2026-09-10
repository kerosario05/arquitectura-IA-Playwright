import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { buildPromotedArtifactIdentity, persistSuccessfulExistingSpecRevalidation, promoteExistingVerifiedSpec, isEligibleForDeterministicRevalidation } from "./persisted-spec-revalidation";
import { persistFreshPlanForExistingSpecReuse } from "./promote-plan";
import { computeTraceFidelity, type SpecExecutionContract } from "./spec-execution-contract";

const valid = {
  previousSpecExisted: true,
  specText: "test('existing', async () => {})",
  specPath: "automations/apps/app-a/cases/c1/case.spec.ts",
  sourceScenario: { title: "Existing" },
  executionContract: { steps: [] },
  identityValidated: true,
  semanticContext: { requiredAssertions: [], observableOracles: [], scenarioSteps: [] },
};

test("existing spec reuse persists the fresh plan without rewriting the physical spec", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-plan-reuse-"));
  const planPath = path.join(root, "plan.json");
  const specPath = path.join(root, "case.spec.ts");
  const stalePlan = { scenario: { caseId: 44757 }, steps: [{ index: 1, action: "click" }], sourceScenario: { title: "stale" } };
  const freshSourceScenario = {
    title: "fresh",
    requirements: [{ id: "req-negative", polarity: "negative" }, { id: "req-positive", polarity: "positive" }],
    steps: [{ index: 7, action: "assert", requirementRefs: ["req-negative"] }, { index: 8, action: "assert", requirementRefs: ["req-positive"] }],
    observableOracles: [
      { id: "oracle-negative", type: "navigation_transition", backed: true, requirement: "r7", requirementRefs: ["req-negative"], polarity: "negative", evidence: [] },
      { id: "oracle-positive", type: "navigation_transition", backed: true, requirement: "r8", requirementRefs: ["req-positive"], polarity: "positive", evidence: [] },
    ],
  } as any;
  const freshContract = {
    steps: [
      { scenarioStepIndex: 7, oracle: { polarity: "negative" } },
      { scenarioStepIndex: 8, oracle: { polarity: "positive" } },
    ],
  };
  const specText = "test('existing', async () => {})";
  fs.writeFileSync(planPath, JSON.stringify(stalePlan));
  fs.writeFileSync(specPath, specText);

  await persistFreshPlanForExistingSpecReuse({ planPath, plan: stalePlan as any, sourceScenario: freshSourceScenario, executionContract: freshContract });

  const persisted = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.deepEqual(persisted.sourceScenario, freshSourceScenario);
  assert.deepEqual(persisted.executionContract, freshContract);
  assert.equal(fs.readFileSync(specPath, "utf8"), specText);
  fs.rmSync(root, { recursive: true, force: true });
});

test("failed previous specs are eligible for deterministic revalidation but not promoted reuse", () => {
  const entry = { status: "spec_failed", specVerificationStatus: "failed" };
  assert.equal(isEligibleForDeterministicRevalidation({ ...valid, ...entry } as any), true);
  assert.equal(entry.status === "active", false);
});

test("GREEN existing-spec revalidation persists identity and verification atomically without promotion", async () => {
  const caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "existing-spec-revalidation-"));
  const caseDir = path.join(caseRoot, "c1-existing");
  fs.mkdirSync(caseDir);
  const specText = "test('existing', async () => {})";
  const plan = { sourceScenario: { title: "Existing" }, executionContract: { scenarioId: "C1", steps: [] }, scenario: { caseId: 1, externalId: "C1" } };
  const automation = {
    appSlug: "app-a", caseId: 1, externalId: "C1", status: "spec_failed", specVerificationStatus: "failed",
    metadata: { specGeneration: { specWritten: false, promotionAllowed: false, previousSpec: { existed: true, hash: "old", lastModifiedAt: null } } },
  };
  fs.writeFileSync(path.join(caseDir, "case.spec.ts"), specText);
  fs.writeFileSync(path.join(caseDir, "plan.json"), JSON.stringify(plan));
  fs.writeFileSync(path.join(caseDir, "automation.json"), JSON.stringify(automation));
  const result = { status: "passed", allRequiredGatesPassed: true, validatedSpecHash: createHash("sha256").update(specText, "utf8").digest("hex"), aiInvocationCount: 0, candidateGenerated: false } as any;
  const persisted = await persistSuccessfulExistingSpecRevalidation({ caseDir, appSlug: "app-a", caseId: 1, identityValidated: true, specText, result });
  const updated = JSON.parse(fs.readFileSync(path.join(caseDir, "automation.json"), "utf8"));
  assert.equal(persisted.persisted, true);
  assert.equal(updated.metadata.specGeneration.previousSpec.hash, result.validatedSpecHash);
  assert.equal(updated.specVerificationStatus, "passed");
  assert.equal(updated.status, "spec_failed");
  assert.equal(updated.metadata.specGeneration.specWritten, false);
  assert.equal(updated.metadata.specGeneration.promotionAllowed, false);
});

test("existing-spec persistence rejects failed revalidation and hash/identity mismatches", async () => {
  const caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "existing-spec-revalidation-reject-"));
  const caseDir = path.join(caseRoot, "c1-existing");
  fs.mkdirSync(caseDir);
  const specText = "test('existing', async () => {})";
  const plan = { sourceScenario: { title: "Existing" }, executionContract: { scenarioId: "C1", steps: [] }, scenario: { caseId: 1, externalId: "C1" } };
  const automation = { appSlug: "app-a", caseId: 1, externalId: "C1", status: "spec_failed", specVerificationStatus: "failed" };
  fs.writeFileSync(path.join(caseDir, "case.spec.ts"), specText);
  fs.writeFileSync(path.join(caseDir, "plan.json"), JSON.stringify(plan));
  fs.writeFileSync(path.join(caseDir, "automation.json"), JSON.stringify(automation));
  const base = { status: "passed", allRequiredGatesPassed: true, validatedSpecHash: "wrong", aiInvocationCount: 0, candidateGenerated: false } as any;
  assert.equal((await persistSuccessfulExistingSpecRevalidation({ caseDir, appSlug: "app-a", caseId: 1, identityValidated: true, specText, result: base })).persisted, false);
  assert.equal((await persistSuccessfulExistingSpecRevalidation({ caseDir, appSlug: "wrong", caseId: 1, identityValidated: true, specText, result: base })).persisted, false);
  assert.equal((await persistSuccessfulExistingSpecRevalidation({ caseDir, appSlug: "app-a", caseId: 1, identityValidated: true, specText, result: { ...base, status: "failed", allRequiredGatesPassed: false } })).persisted, false);
});

test("promotes persisted verified existing spec without generation or runtime", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "existing-spec-promotion-"));
  const appDir = path.join(root, "automations", "apps", "app-a");
  const caseDir = path.join(appDir, "sections", "section-a", "cases", "c1-existing");
  fs.mkdirSync(caseDir, { recursive: true });
  const specText = "test('existing', async () => {})";
  const hash = createHash("sha256").update(specText, "utf8").digest("hex");
  const plan = { sourceScenario: { title: "Existing" }, executionContract: { scenarioId: "C1", steps: [] }, scenario: { caseId: 1, externalId: "C1" } };
  const automation = { id: "c1-existing", appSlug: "app-a", caseId: 1, externalId: "C1", status: "spec_failed", specVerificationStatus: "passed", metadata: { specGeneration: { promotionAllowed: false, specWritten: false, previousSpec: { existed: true, hash, lastModifiedAt: null }, deterministicRevalidation: { passed: true, validatedSpecHash: hash, persistedAt: new Date().toISOString() } } } };
  const index = { version: "1.0", updatedAt: new Date().toISOString(), automations: [automation] };
  fs.writeFileSync(path.join(caseDir, "case.spec.ts"), specText);
  fs.writeFileSync(path.join(caseDir, "plan.json"), JSON.stringify(plan));
  fs.writeFileSync(path.join(caseDir, "automation.json"), JSON.stringify(automation));
  fs.writeFileSync(path.join(appDir, "index.json"), JSON.stringify(index));
  fs.writeFileSync(path.join(root, "automations", "index.json"), JSON.stringify(index));
  const result = await promoteExistingVerifiedSpec({ caseDir, appSlug: "app-a", sectionSlug: "section-a", caseId: 1, specPath: path.join(caseDir, "case.spec.ts") });
  const updated = JSON.parse(fs.readFileSync(path.join(caseDir, "automation.json"), "utf8"));
  assert.equal(result.promotionSucceeded, true);
  assert.equal(updated.status, "active");
  assert.equal(updated.specVerificationStatus, "passed");
  assert.equal(updated.metadata.specGeneration.previousSpec.hash, hash);
  assert.equal(updated.promotionPersisted, true);
  assert.equal(updated.promotedSpecPath, path.resolve(caseDir, "case.spec.ts"));
  assert.equal(updated.promotedSpecHash, hash);
  assert.equal(updated.metadata.specGeneration.specWritten, false);
});

test("shared promoted identity hashes the final artifact path and content", () => {
  const identity = buildPromotedArtifactIdentity("./case.spec.ts", "final spec");
  assert.equal(identity.promotionPersisted, true);
  assert.equal(identity.promotedSpecPath, path.resolve("./case.spec.ts"));
  assert.equal(identity.promotedSpecHash, createHash("sha256").update("final spec", "utf8").digest("hex"));
});

test("deterministic revalidation remains fail-closed for identity and required context", () => {
  assert.equal(isEligibleForDeterministicRevalidation({ ...valid, identityValidated: false }), false);
  assert.equal(isEligibleForDeterministicRevalidation({ ...valid, specText: "" }), false);
  assert.equal(isEligibleForDeterministicRevalidation({ ...valid, sourceScenario: undefined }), false);
  assert.equal(isEligibleForDeterministicRevalidation({ ...valid, executionContract: undefined }), false);
  assert.equal(isEligibleForDeterministicRevalidation({ ...valid, semanticContext: undefined }), false);
});

const traceContract = (optionalStepRequired: boolean): SpecExecutionContract => ({
  version: "1.0",
  scenarioId: "C1",
  title: "Trace",
  steps: [
    { contractStepIndex: 0, scenarioStepIndex: 1, originalText: "Required", operation: "click", target: { strategy: "text", value: "Continue" }, required: true, executionStatus: "executed", evidenceRefs: [] },
    { contractStepIndex: 1, scenarioStepIndex: 2, originalText: "Optional", operation: "assertVisible", target: { strategy: "text", value: "Optional" }, required: optionalStepRequired, executionStatus: "contextual_unresolved", evidenceRefs: [] },
  ],
  unresolvedRequiredOracles: [],
  diagnostics: { requiredScenarioSteps: optionalStepRequired ? 2 : 1, representedScenarioSteps: optionalStepRequired ? 2 : 1, missingScenarioSteps: [] },
});

test("trace fidelity counts required steps while retaining strict required checks", () => {
  const optionalMissing = computeTraceFidelity(
    "await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} });",
    traceContract(false),
  );
  assert.equal(optionalMissing.status, "passed");
  assert.equal(optionalMissing.expected, 1);
  assert.equal(optionalMissing.implemented, 1);

  const requiredMissing = computeTraceFidelity(
    "await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} });",
    traceContract(true),
  );
  assert.equal(requiredMissing.status, "failed");
  assert.ok(requiredMissing.errors.some((error) => error.includes("missing_contract_step:stepIndex=2")));

  const requiredMismatch = computeTraceFidelity(
    "await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Wrong', action: async () => {} });",
    traceContract(false),
  );
  assert.equal(requiredMismatch.status, "failed");
  assert.ok(requiredMismatch.errors.some((error) => error.includes("contract_target_changed:stepIndex=1")));

  const bootstrap = computeTraceFidelity(
    "await page.goto('https://example.test'); await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} });",
    traceContract(false),
  );
  assert.equal(bootstrap.status, "passed");

  const afterScenarioStart = computeTraceFidelity(
    "await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} }); await page.goto('https://example.test');",
    traceContract(false),
  );
  assert.ok(afterScenarioStart.errors.some((error) => error.includes("extraneous_business_step:kind=page.goto:count=1")));

  const secondGoto = computeTraceFidelity(
    "await page.goto('https://example.test'); await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} }); await page.goto('https://example.test/again');",
    traceContract(false),
  );
  assert.ok(secondGoto.errors.some((error) => error.includes("extraneous_business_step:kind=page.goto:count=1")));

  const contractualNavigation = computeTraceFidelity(
    "await page.goto('https://example.test'); await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} });",
    { ...traceContract(false), steps: [{ ...traceContract(false).steps[0], operation: "navigate" }] },
  );
  assert.equal(contractualNavigation.errors.some((error) => error.includes("extraneous_business_step:kind=page.goto")), false);
});

test("current C44757 assertions align to steps 7 and 8 after Salir", () => {
  const caseDir = "automations/apps/portalempresarial/sections/automatizacion-1/cases/c44757-login-satisfactorio";
  const plan = JSON.parse(fs.readFileSync(`${caseDir}/plan.json`, "utf8"));
  const spec = fs.readFileSync(`${caseDir}/case.spec.ts`, "utf8");
  const result = computeTraceFidelity(spec, plan.executionContract);
  assert.equal(result.errors.some((error: string) => error.includes("contract_target_changed:stepIndex=6")), false);
  assert.equal(result.errors.some((error: string) => error.includes("contract_target_changed:stepIndex=7")), false);
  assert.equal(plan.executionContract.steps.find((step: any) => step.scenarioStepIndex === 8)?.required, true);
  assert.equal(result.errors.some((error: string) => error.includes("extraneous_business_step:kind=page.goto")), false);
});

test("RED: previous spec currently misses the contractual Salir click", () => {
  const contract: SpecExecutionContract = {
    version: "1.0", scenarioId: "C44757", title: "Login satisfactorio",
    steps: [{ contractStepIndex: 5, scenarioStepIndex: 6, originalText: "Clic en el boton \\\"Salir\\\"", operation: "click", target: { strategy: "text", value: "Salir" }, required: true, executionStatus: "executed", evidenceRefs: [] }],
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] },
  };
  const result = computeTraceFidelity(
    "await promotedRuntime.expectPromotedVisible({ stepIndex: 6, target: 'Validar que el formulario de acceso ya no sea la pantalla activa.', assertion: async () => {} });",
    contract,
  );
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("contract_target_changed:stepIndex=6")));
});
