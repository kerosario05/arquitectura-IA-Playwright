import test from "node:test";
import assert from "node:assert/strict";
import { tryPromoteExistingSpecBeforeGeneration } from "./promote-plan";

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

test("GREEN existing spec is persisted and promoted without generation", async () => {
  const calls: string[] = [];
  const result = await tryPromoteExistingSpecBeforeGeneration({
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
      loadAutomation: async () => ({ status: "spec_failed", specVerificationStatus: "passed" } as any),
      promote: async () => {
        calls.push("promote");
        return { promotionSucceeded: true };
      },
    },
  });

  assert.deepEqual(result, { handled: true, promoted: true });
  assert.deepEqual(calls, ["revalidate", "persist", "promote"]);
});

test("successful existing-spec reuse persists the exact fresh objects before returning", async () => {
  const calls: string[] = [];
  const freshPlan = { scenario: { caseId: 44757 }, steps: [] } as any;
  const freshSourceScenario = {
    ...sourceScenario,
    observableOracles: [
      { id: "negative", requirement: "previous state absent", type: "navigation_transition", backed: true, requirementRefs: ["req-negative"], polarity: "negative", evidence: [] },
      { id: "positive", requirement: "authenticated state present", type: "navigation_transition", backed: true, requirementRefs: ["req-positive"], polarity: "positive", evidence: [] },
    ],
  } as any;
  const freshExecutionContract = {
    scenarioId: "44757",
    steps: [
      { scenarioStepIndex: 7, oracle: { polarity: "negative" } },
      { scenarioStepIndex: 8, oracle: { polarity: "positive" } },
    ],
  } as any;
  let persistedPlan: unknown;
  let persistedSourceScenario: unknown;
  let persistedExecutionContract: unknown;
  const result = await tryPromoteExistingSpecBeforeGeneration({
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
      loadAutomation: async () => ({ status: "spec_failed", specVerificationStatus: "passed" } as any),
      promote: async () => { calls.push("promote"); return { promotionSucceeded: true }; },
    },
  });

  assert.deepEqual(result, { handled: true, promoted: true });
  assert.deepEqual(calls, ["revalidate", "persist", "promote", "persistFreshPlan"]);
  assert.equal(persistedPlan, freshPlan);
  assert.equal(persistedSourceScenario, freshSourceScenario);
  assert.equal(persistedExecutionContract, freshExecutionContract);
  assert.equal((freshSourceScenario.observableOracles[0] as any).polarity, "negative");
  assert.equal((freshSourceScenario.observableOracles[1] as any).polarity, "positive");
});

test("failed existing-spec revalidation does not persist the fresh plan", async () => {
  let freshPlanPersisted = false;
  const result = await tryPromoteExistingSpecBeforeGeneration({
    caseDir: "case-dir",
    specPath: "case-dir/case.spec.ts",
    planPath: "case-dir/plan.json",
    freshPlan: { scenario: { caseId: 44757 }, steps: [] } as any,
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

  assert.equal(result.reason, "deterministic_revalidation_failed");
  assert.equal(freshPlanPersisted, false);
});

test("fresh plan write failure prevents successful existing-spec reuse", async () => {
  await assert.rejects(() => tryPromoteExistingSpecBeforeGeneration({
    caseDir: "case-dir",
    specPath: "case-dir/case.spec.ts",
    planPath: "case-dir/plan.json",
    freshPlan: { scenario: { caseId: 44757 }, steps: [] } as any,
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
      loadAutomation: async () => ({ status: "active", specVerificationStatus: "passed" } as any),
      validateAuthority: () => ({ valid: true }),
    },
  }));
});

test("failed revalidation remains an AI-generation fallback", async () => {
  const result = await tryPromoteExistingSpecBeforeGeneration({
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

  assert.equal(result.handled, false);
  assert.equal(result.reason, "deterministic_revalidation_failed");
});

test("active GREEN authority short-circuits without existing promotion or generation", async () => {
  const calls: string[] = [];
  const result = await tryPromoteExistingSpecBeforeGeneration({
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
      loadAutomation: async () => ({ status: "active", specVerificationStatus: "passed" } as any),
      validateAuthority: () => { calls.push("authority"); return { valid: true }; },
      promote: async () => { calls.push("promote"); return { promotionSucceeded: true }; },
    },
  });

  assert.deepEqual(result, { handled: true, promoted: true, reason: "existing_active_revalidated" });
  assert.deepEqual(calls, ["persist", "authority"]);
});

test("active authority mismatch remains a generation fallback", async () => {
  const result = await tryPromoteExistingSpecBeforeGeneration({
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
      loadAutomation: async () => ({ status: "active" } as any),
      validateAuthority: () => ({ valid: false, reason: "promoted_spec_hash_mismatch" }),
    },
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, "active_authority_promoted_spec_hash_mismatch");
});
