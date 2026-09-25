"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const promote_plan_1 = require("./promote-plan");
const sourceScenario = {
    title: "current",
    steps: [{ index: 1, action: "click", description: "Salir" }],
    observableOracles: [{ id: "o1", requirement: "Salir is visible", type: "visible", backed: true, evidence: [] }],
};
const semanticContext = {
    requiredAssertions: ["Salir is visible"],
    observableOracles: sourceScenario.observableOracles,
    scenarioSteps: sourceScenario.steps,
    semanticErrors: [],
};
(0, node_test_1.default)("GREEN existing spec is persisted and promoted without generation", async () => {
    const calls = [];
    const result = await (0, promote_plan_1.tryPromoteExistingSpecBeforeGeneration)({
        caseDir: "case-dir",
        specPath: "case-dir/case.spec.ts",
        appSlug: "app",
        sectionSlug: "section",
        caseId: 44757,
        sourceScenario,
        executionContract: { scenarioId: "44757" },
        semanticContext,
        dependencies: {
            loadContext: async () => ({
                specText: "existing spec",
                specPath: "case-dir/case.spec.ts",
                specHash: "hash",
                contextSources: { spec: "case.spec.ts", sourceScenario: "plan.json", executionContract: "plan.json" },
                identityValidated: true,
                missingContextFields: [],
            }),
            isEligible: () => true,
            revalidate: async () => {
                calls.push("revalidate");
                return { status: "passed", allRequiredGatesPassed: true, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash: "hash" };
            },
            persist: async () => {
                calls.push("persist");
                return { persisted: true };
            },
            loadAutomation: async () => ({ status: "spec_failed", specVerificationStatus: "passed" }),
            promote: async () => {
                calls.push("promote");
                return { promotionSucceeded: true };
            },
        },
    });
    strict_1.default.deepEqual(result, { handled: true, promoted: true });
    strict_1.default.deepEqual(calls, ["revalidate", "persist", "promote"]);
});
(0, node_test_1.default)("successful existing-spec reuse persists the exact fresh objects before returning", async () => {
    const calls = [];
    const freshPlan = { scenario: { caseId: 44757 }, steps: [] };
    const freshSourceScenario = {
        ...sourceScenario,
        observableOracles: [
            { id: "negative", requirement: "previous state absent", type: "navigation_transition", backed: true, requirementRefs: ["req-negative"], polarity: "negative", evidence: [] },
            { id: "positive", requirement: "authenticated state present", type: "navigation_transition", backed: true, requirementRefs: ["req-positive"], polarity: "positive", evidence: [] },
        ],
    };
    const freshExecutionContract = {
        scenarioId: "44757",
        steps: [
            { scenarioStepIndex: 7, oracle: { polarity: "negative" } },
            { scenarioStepIndex: 8, oracle: { polarity: "positive" } },
        ],
    };
    let persistedPlan;
    let persistedSourceScenario;
    let persistedExecutionContract;
    const result = await (0, promote_plan_1.tryPromoteExistingSpecBeforeGeneration)({
        caseDir: "case-dir",
        specPath: "case-dir/case.spec.ts",
        planPath: "case-dir/plan.json",
        freshPlan,
        appSlug: "app",
        sectionSlug: "section",
        caseId: 44757,
        sourceScenario: freshSourceScenario,
        executionContract: freshExecutionContract,
        semanticContext,
        dependencies: {
            loadContext: async () => ({ specText: "existing spec", specPath: "case-dir/case.spec.ts", specHash: "hash", contextSources: { spec: "case.spec.ts", sourceScenario: "plan.json", executionContract: "plan.json" }, identityValidated: true, missingContextFields: [] }),
            isEligible: () => true,
            revalidate: async () => { calls.push("revalidate"); return { status: "passed", allRequiredGatesPassed: true, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash: "hash" }; },
            persist: async () => { calls.push("persist"); return { persisted: true }; },
            persistFreshPlan: async (input) => { calls.push("persistFreshPlan"); persistedPlan = input.plan; persistedSourceScenario = input.sourceScenario; persistedExecutionContract = input.executionContract; },
            loadAutomation: async () => ({ status: "spec_failed", specVerificationStatus: "passed" }),
            promote: async () => { calls.push("promote"); return { promotionSucceeded: true }; },
        },
    });
    strict_1.default.deepEqual(result, { handled: true, promoted: true });
    strict_1.default.deepEqual(calls, ["revalidate", "persist", "promote", "persistFreshPlan"]);
    strict_1.default.equal(persistedPlan, freshPlan);
    strict_1.default.equal(persistedSourceScenario, freshSourceScenario);
    strict_1.default.equal(persistedExecutionContract, freshExecutionContract);
    strict_1.default.equal(freshSourceScenario.observableOracles[0].polarity, "negative");
    strict_1.default.equal(freshSourceScenario.observableOracles[1].polarity, "positive");
});
(0, node_test_1.default)("failed existing-spec revalidation does not persist the fresh plan", async () => {
    let freshPlanPersisted = false;
    const result = await (0, promote_plan_1.tryPromoteExistingSpecBeforeGeneration)({
        caseDir: "case-dir",
        specPath: "case-dir/case.spec.ts",
        planPath: "case-dir/plan.json",
        freshPlan: { scenario: { caseId: 44757 }, steps: [] },
        appSlug: "app",
        sourceScenario,
        executionContract: { scenarioId: "44757" },
        semanticContext,
        dependencies: {
            loadContext: async () => ({ specText: "existing spec", specPath: "case-dir/case.spec.ts", specHash: "hash", contextSources: { spec: "case.spec.ts", sourceScenario: "plan.json", executionContract: "plan.json" }, identityValidated: true, missingContextFields: [] }),
            isEligible: () => true,
            revalidate: async () => ({ status: "failed", allRequiredGatesPassed: false, aiInvocationCount: 0, candidateGenerated: false }),
            persistFreshPlan: async () => { freshPlanPersisted = true; },
        },
    });
    strict_1.default.equal(result.reason, "deterministic_revalidation_failed");
    strict_1.default.equal(freshPlanPersisted, false);
});
(0, node_test_1.default)("fresh plan write failure prevents successful existing-spec reuse", async () => {
    await strict_1.default.rejects(() => (0, promote_plan_1.tryPromoteExistingSpecBeforeGeneration)({
        caseDir: "case-dir",
        specPath: "case-dir/case.spec.ts",
        planPath: "case-dir/plan.json",
        freshPlan: { scenario: { caseId: 44757 }, steps: [] },
        appSlug: "app",
        sourceScenario,
        executionContract: { scenarioId: "44757" },
        semanticContext,
        dependencies: {
            loadContext: async () => ({ specText: "existing spec", specPath: "case-dir/case.spec.ts", specHash: "hash", contextSources: { spec: "case.spec.ts", sourceScenario: "plan.json", executionContract: "plan.json" }, identityValidated: true, missingContextFields: [] }),
            isEligible: () => true,
            revalidate: async () => ({ status: "passed", allRequiredGatesPassed: true, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash: "hash" }),
            persist: async () => ({ persisted: true }),
            persistFreshPlan: async () => { throw new Error("plan_write_failed"); },
            loadAutomation: async () => ({ status: "active", specVerificationStatus: "passed" }),
            validateAuthority: () => ({ valid: true }),
        },
    }));
});
(0, node_test_1.default)("failed revalidation remains an AI-generation fallback", async () => {
    const result = await (0, promote_plan_1.tryPromoteExistingSpecBeforeGeneration)({
        caseDir: "case-dir",
        specPath: "case-dir/case.spec.ts",
        appSlug: "app",
        sourceScenario,
        executionContract: { scenarioId: "44757" },
        semanticContext,
        dependencies: {
            loadContext: async () => ({
                specText: "existing spec",
                specPath: "case-dir/case.spec.ts",
                specHash: "hash",
                contextSources: { spec: "case.spec.ts", sourceScenario: "plan.json", executionContract: "plan.json" },
                identityValidated: true,
                missingContextFields: [],
            }),
            isEligible: () => true,
            revalidate: async () => ({ status: "failed", allRequiredGatesPassed: false, aiInvocationCount: 0, candidateGenerated: false }),
        },
    });
    strict_1.default.equal(result.handled, false);
    strict_1.default.equal(result.reason, "deterministic_revalidation_failed");
});
(0, node_test_1.default)("active GREEN authority short-circuits without existing promotion or generation", async () => {
    const calls = [];
    const result = await (0, promote_plan_1.tryPromoteExistingSpecBeforeGeneration)({
        caseDir: "case-dir",
        specPath: "case-dir/case.spec.ts",
        appSlug: "app",
        sectionSlug: "section",
        caseId: 7,
        sourceScenario,
        executionContract: { scenarioId: "7" },
        semanticContext,
        dependencies: {
            loadContext: async () => ({ specText: "existing spec", specPath: "case-dir/case.spec.ts", specHash: "hash", contextSources: { spec: "case.spec.ts", sourceScenario: "plan.json", executionContract: "plan.json" }, identityValidated: true, missingContextFields: [] }),
            isEligible: () => true,
            revalidate: async () => ({ status: "passed", allRequiredGatesPassed: true, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash: "hash" }),
            persist: async () => { calls.push("persist"); return { persisted: true }; },
            loadAutomation: async () => ({ status: "active", specVerificationStatus: "passed" }),
            validateAuthority: () => { calls.push("authority"); return { valid: true }; },
            promote: async () => { calls.push("promote"); return { promotionSucceeded: true }; },
        },
    });
    strict_1.default.deepEqual(result, { handled: true, promoted: true, reason: "existing_active_revalidated" });
    strict_1.default.deepEqual(calls, ["persist", "authority"]);
});
(0, node_test_1.default)("active authority mismatch remains a generation fallback", async () => {
    const result = await (0, promote_plan_1.tryPromoteExistingSpecBeforeGeneration)({
        caseDir: "case-dir",
        specPath: "case-dir/case.spec.ts",
        appSlug: "app",
        sourceScenario,
        executionContract: { scenarioId: "7" },
        semanticContext,
        dependencies: {
            loadContext: async () => ({ specText: "existing spec", specPath: "case-dir/case.spec.ts", specHash: "hash", contextSources: { spec: "case.spec.ts", sourceScenario: "plan.json", executionContract: "plan.json" }, identityValidated: true, missingContextFields: [] }),
            isEligible: () => true,
            revalidate: async () => ({ status: "passed", allRequiredGatesPassed: true, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash: "hash" }),
            persist: async () => ({ persisted: true }),
            loadAutomation: async () => ({ status: "active" }),
            validateAuthority: () => ({ valid: false, reason: "promoted_spec_hash_mismatch" }),
        },
    });
    strict_1.default.equal(result.handled, false);
    strict_1.default.equal(result.reason, "active_authority_promoted_spec_hash_mismatch");
});
