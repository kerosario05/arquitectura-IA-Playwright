"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_test_1 = __importDefault(require("node:test"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const persisted_spec_revalidation_1 = require("./persisted-spec-revalidation");
const promote_plan_1 = require("./promote-plan");
const spec_execution_contract_1 = require("./spec-execution-contract");
const valid = {
    previousSpecExisted: true,
    specText: "test('existing', async () => {})",
    specPath: "automations/apps/app-a/cases/c1/case.spec.ts",
    sourceScenario: { title: "Existing" },
    executionContract: { steps: [] },
    identityValidated: true,
    semanticContext: { requiredAssertions: [], observableOracles: [], scenarioSteps: [] },
};
(0, node_test_1.default)("existing spec reuse persists the fresh plan without rewriting the physical spec", async () => {
    const root = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "fresh-plan-reuse-"));
    const planPath = node_path_1.default.join(root, "plan.json");
    const specPath = node_path_1.default.join(root, "case.spec.ts");
    const stalePlan = { scenario: { caseId: 44757 }, steps: [{ index: 1, action: "click" }], sourceScenario: { title: "stale" } };
    const freshSourceScenario = {
        title: "fresh",
        requirements: [{ id: "req-negative", polarity: "negative" }, { id: "req-positive", polarity: "positive" }],
        steps: [{ index: 7, action: "assert", requirementRefs: ["req-negative"] }, { index: 8, action: "assert", requirementRefs: ["req-positive"] }],
        observableOracles: [
            { id: "oracle-negative", type: "navigation_transition", backed: true, requirement: "r7", requirementRefs: ["req-negative"], polarity: "negative", evidence: [] },
            { id: "oracle-positive", type: "navigation_transition", backed: true, requirement: "r8", requirementRefs: ["req-positive"], polarity: "positive", evidence: [] },
        ],
    };
    const freshContract = {
        steps: [
            { scenarioStepIndex: 7, oracle: { polarity: "negative" } },
            { scenarioStepIndex: 8, oracle: { polarity: "positive" } },
        ],
    };
    const specText = "test('existing', async () => {})";
    node_fs_1.default.writeFileSync(planPath, JSON.stringify(stalePlan));
    node_fs_1.default.writeFileSync(specPath, specText);
    await (0, promote_plan_1.persistFreshPlanForExistingSpecReuse)({ planPath, plan: stalePlan, sourceScenario: freshSourceScenario, executionContract: freshContract });
    const persisted = JSON.parse(node_fs_1.default.readFileSync(planPath, "utf8"));
    strict_1.default.deepEqual(persisted.sourceScenario, freshSourceScenario);
    strict_1.default.deepEqual(persisted.executionContract, freshContract);
    strict_1.default.equal(node_fs_1.default.readFileSync(specPath, "utf8"), specText);
    node_fs_1.default.rmSync(root, { recursive: true, force: true });
});
(0, node_test_1.default)("failed previous specs are eligible for deterministic revalidation but not promoted reuse", () => {
    const entry = { status: "spec_failed", specVerificationStatus: "failed" };
    strict_1.default.equal((0, persisted_spec_revalidation_1.isEligibleForDeterministicRevalidation)({ ...valid, ...entry }), true);
    strict_1.default.equal(entry.status === "active", false);
});
(0, node_test_1.default)("GREEN existing-spec revalidation persists identity and verification atomically without promotion", async () => {
    const caseRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "existing-spec-revalidation-"));
    const caseDir = node_path_1.default.join(caseRoot, "c1-existing");
    node_fs_1.default.mkdirSync(caseDir);
    const specText = "test('existing', async () => {})";
    const plan = { sourceScenario: { title: "Existing" }, executionContract: { scenarioId: "C1", steps: [] }, scenario: { caseId: 1, externalId: "C1" } };
    const automation = {
        appSlug: "app-a", caseId: 1, externalId: "C1", status: "spec_failed", specVerificationStatus: "failed",
        metadata: { specGeneration: { specWritten: false, promotionAllowed: false, previousSpec: { existed: true, hash: "old", lastModifiedAt: null } } },
    };
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "case.spec.ts"), specText);
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "plan.json"), JSON.stringify(plan));
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "automation.json"), JSON.stringify(automation));
    const result = { status: "passed", allRequiredGatesPassed: true, validatedSpecHash: (0, node_crypto_1.createHash)("sha256").update(specText, "utf8").digest("hex"), aiInvocationCount: 0, candidateGenerated: false };
    const persisted = await (0, persisted_spec_revalidation_1.persistSuccessfulExistingSpecRevalidation)({ caseDir, appSlug: "app-a", caseId: 1, identityValidated: true, specText, result });
    const updated = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(caseDir, "automation.json"), "utf8"));
    strict_1.default.equal(persisted.persisted, true);
    strict_1.default.equal(updated.metadata.specGeneration.previousSpec.hash, result.validatedSpecHash);
    strict_1.default.equal(updated.specVerificationStatus, "passed");
    strict_1.default.equal(updated.status, "spec_failed");
    strict_1.default.equal(updated.metadata.specGeneration.specWritten, false);
    strict_1.default.equal(updated.metadata.specGeneration.promotionAllowed, false);
});
(0, node_test_1.default)("existing-spec persistence rejects failed revalidation and hash/identity mismatches", async () => {
    const caseRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "existing-spec-revalidation-reject-"));
    const caseDir = node_path_1.default.join(caseRoot, "c1-existing");
    node_fs_1.default.mkdirSync(caseDir);
    const specText = "test('existing', async () => {})";
    const plan = { sourceScenario: { title: "Existing" }, executionContract: { scenarioId: "C1", steps: [] }, scenario: { caseId: 1, externalId: "C1" } };
    const automation = { appSlug: "app-a", caseId: 1, externalId: "C1", status: "spec_failed", specVerificationStatus: "failed" };
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "case.spec.ts"), specText);
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "plan.json"), JSON.stringify(plan));
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "automation.json"), JSON.stringify(automation));
    const base = { status: "passed", allRequiredGatesPassed: true, validatedSpecHash: "wrong", aiInvocationCount: 0, candidateGenerated: false };
    strict_1.default.equal((await (0, persisted_spec_revalidation_1.persistSuccessfulExistingSpecRevalidation)({ caseDir, appSlug: "app-a", caseId: 1, identityValidated: true, specText, result: base })).persisted, false);
    strict_1.default.equal((await (0, persisted_spec_revalidation_1.persistSuccessfulExistingSpecRevalidation)({ caseDir, appSlug: "wrong", caseId: 1, identityValidated: true, specText, result: base })).persisted, false);
    strict_1.default.equal((await (0, persisted_spec_revalidation_1.persistSuccessfulExistingSpecRevalidation)({ caseDir, appSlug: "app-a", caseId: 1, identityValidated: true, specText, result: { ...base, status: "failed", allRequiredGatesPassed: false } })).persisted, false);
});
(0, node_test_1.default)("promotes persisted verified existing spec without generation or runtime", async () => {
    const root = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "existing-spec-promotion-"));
    const appDir = node_path_1.default.join(root, "automations", "apps", "app-a");
    const caseDir = node_path_1.default.join(appDir, "sections", "section-a", "cases", "c1-existing");
    node_fs_1.default.mkdirSync(caseDir, { recursive: true });
    const specText = "test('existing', async () => {})";
    const hash = (0, node_crypto_1.createHash)("sha256").update(specText, "utf8").digest("hex");
    const plan = { sourceScenario: { title: "Existing" }, executionContract: { scenarioId: "C1", steps: [] }, scenario: { caseId: 1, externalId: "C1" } };
    const automation = { id: "c1-existing", appSlug: "app-a", caseId: 1, externalId: "C1", status: "spec_failed", specVerificationStatus: "passed", metadata: { specGeneration: { promotionAllowed: false, specWritten: false, previousSpec: { existed: true, hash, lastModifiedAt: null }, deterministicRevalidation: { passed: true, validatedSpecHash: hash, persistedAt: new Date().toISOString() } } } };
    const index = { version: "1.0", updatedAt: new Date().toISOString(), automations: [automation] };
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "case.spec.ts"), specText);
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "plan.json"), JSON.stringify(plan));
    node_fs_1.default.writeFileSync(node_path_1.default.join(caseDir, "automation.json"), JSON.stringify(automation));
    node_fs_1.default.writeFileSync(node_path_1.default.join(appDir, "index.json"), JSON.stringify(index));
    node_fs_1.default.writeFileSync(node_path_1.default.join(root, "automations", "index.json"), JSON.stringify(index));
    const result = await (0, persisted_spec_revalidation_1.promoteExistingVerifiedSpec)({ caseDir, appSlug: "app-a", sectionSlug: "section-a", caseId: 1, specPath: node_path_1.default.join(caseDir, "case.spec.ts") });
    const updated = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(caseDir, "automation.json"), "utf8"));
    strict_1.default.equal(result.promotionSucceeded, true);
    strict_1.default.equal(updated.status, "active");
    strict_1.default.equal(updated.specVerificationStatus, "passed");
    strict_1.default.equal(updated.metadata.specGeneration.previousSpec.hash, hash);
    strict_1.default.equal(updated.promotionPersisted, true);
    strict_1.default.equal(updated.promotedSpecPath, node_path_1.default.resolve(caseDir, "case.spec.ts"));
    strict_1.default.equal(updated.promotedSpecHash, hash);
    strict_1.default.equal(updated.metadata.specGeneration.specWritten, false);
});
(0, node_test_1.default)("shared promoted identity hashes the final artifact path and content", () => {
    const identity = (0, persisted_spec_revalidation_1.buildPromotedArtifactIdentity)("./case.spec.ts", "final spec");
    strict_1.default.equal(identity.promotionPersisted, true);
    strict_1.default.equal(identity.promotedSpecPath, node_path_1.default.resolve("./case.spec.ts"));
    strict_1.default.equal(identity.promotedSpecHash, (0, node_crypto_1.createHash)("sha256").update("final spec", "utf8").digest("hex"));
});
(0, node_test_1.default)("deterministic revalidation remains fail-closed for identity and required context", () => {
    strict_1.default.equal((0, persisted_spec_revalidation_1.isEligibleForDeterministicRevalidation)({ ...valid, identityValidated: false }), false);
    strict_1.default.equal((0, persisted_spec_revalidation_1.isEligibleForDeterministicRevalidation)({ ...valid, specText: "" }), false);
    strict_1.default.equal((0, persisted_spec_revalidation_1.isEligibleForDeterministicRevalidation)({ ...valid, sourceScenario: undefined }), false);
    strict_1.default.equal((0, persisted_spec_revalidation_1.isEligibleForDeterministicRevalidation)({ ...valid, executionContract: undefined }), false);
    strict_1.default.equal((0, persisted_spec_revalidation_1.isEligibleForDeterministicRevalidation)({ ...valid, semanticContext: undefined }), false);
});
const traceContract = (optionalStepRequired) => ({
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
(0, node_test_1.default)("trace fidelity counts required steps while retaining strict required checks", () => {
    const optionalMissing = (0, spec_execution_contract_1.computeTraceFidelity)("await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} });", traceContract(false));
    strict_1.default.equal(optionalMissing.status, "passed");
    strict_1.default.equal(optionalMissing.expected, 1);
    strict_1.default.equal(optionalMissing.implemented, 1);
    const requiredMissing = (0, spec_execution_contract_1.computeTraceFidelity)("await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} });", traceContract(true));
    strict_1.default.equal(requiredMissing.status, "failed");
    strict_1.default.ok(requiredMissing.errors.some((error) => error.includes("missing_contract_step:stepIndex=2")));
    const requiredMismatch = (0, spec_execution_contract_1.computeTraceFidelity)("await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Wrong', action: async () => {} });", traceContract(false));
    strict_1.default.equal(requiredMismatch.status, "failed");
    strict_1.default.ok(requiredMismatch.errors.some((error) => error.includes("contract_target_changed:stepIndex=1")));
    const bootstrap = (0, spec_execution_contract_1.computeTraceFidelity)("await page.goto('https://example.test'); await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} });", traceContract(false));
    strict_1.default.equal(bootstrap.status, "passed");
    const afterScenarioStart = (0, spec_execution_contract_1.computeTraceFidelity)("await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} }); await page.goto('https://example.test');", traceContract(false));
    strict_1.default.ok(afterScenarioStart.errors.some((error) => error.includes("extraneous_business_step:kind=page.goto:count=1")));
    const secondGoto = (0, spec_execution_contract_1.computeTraceFidelity)("await page.goto('https://example.test'); await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} }); await page.goto('https://example.test/again');", traceContract(false));
    strict_1.default.ok(secondGoto.errors.some((error) => error.includes("extraneous_business_step:kind=page.goto:count=1")));
    const contractualNavigation = (0, spec_execution_contract_1.computeTraceFidelity)("await page.goto('https://example.test'); await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Continue', action: async () => {} });", { ...traceContract(false), steps: [{ ...traceContract(false).steps[0], operation: "navigate" }] });
    strict_1.default.equal(contractualNavigation.errors.some((error) => error.includes("extraneous_business_step:kind=page.goto")), false);
});
(0, node_test_1.default)("current C44757 assertions align to steps 7 and 8 after Salir", () => {
    const caseDir = "automations/apps/portalempresarial/sections/automatizacion-1/cases/c44757-login-satisfactorio";
    const plan = JSON.parse(node_fs_1.default.readFileSync(`${caseDir}/plan.json`, "utf8"));
    const spec = node_fs_1.default.readFileSync(`${caseDir}/case.spec.ts`, "utf8");
    const result = (0, spec_execution_contract_1.computeTraceFidelity)(spec, plan.executionContract);
    strict_1.default.equal(result.errors.some((error) => error.includes("contract_target_changed:stepIndex=6")), false);
    strict_1.default.equal(result.errors.some((error) => error.includes("contract_target_changed:stepIndex=7")), false);
    strict_1.default.equal(plan.executionContract.steps.find((step) => step.scenarioStepIndex === 8)?.required, true);
    strict_1.default.equal(result.errors.some((error) => error.includes("extraneous_business_step:kind=page.goto")), false);
});
(0, node_test_1.default)("RED: previous spec currently misses the contractual Salir click", () => {
    const contract = {
        version: "1.0", scenarioId: "C44757", title: "Login satisfactorio",
        steps: [{ contractStepIndex: 5, scenarioStepIndex: 6, originalText: "Clic en el boton \\\"Salir\\\"", operation: "click", target: { strategy: "text", value: "Salir" }, required: true, executionStatus: "executed", evidenceRefs: [] }],
        unresolvedRequiredOracles: [],
        diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] },
    };
    const result = (0, spec_execution_contract_1.computeTraceFidelity)("await promotedRuntime.expectPromotedVisible({ stepIndex: 6, target: 'Validar que el formulario de acceso ya no sea la pantalla activa.', assertion: async () => {} });", contract);
    strict_1.default.equal(result.status, "failed");
    strict_1.default.ok(result.errors.some((error) => error.includes("contract_target_changed:stepIndex=6")));
});
