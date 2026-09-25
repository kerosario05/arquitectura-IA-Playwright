import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runHybridSpecGeneration } from "./spec-generation-hybrid";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { compileDeterministicSpec } from "./spec-compiler/deterministic-spec-compiler";
import type { AppAutomationPaths, AppProfile } from "./app-profile";
import type { ExecutionPlan } from "../types/execution-plan.types";

/**
 * Reproduces the EXACT physical configuration from jobId=acf2580a-03be-425c-b994-ab370334f2e0:
 * AI_SPEC_GENERATION_ENABLED=true (the real QA Lab environment's actual setting) with the
 * deterministic compiler branch active. Previous deterministic tests all set
 * AI_SPEC_GENERATION_ENABLED=false, which never exercised the aiEnabled=true branch and so
 * never could have caught this FIRST_LOSS: runHybridSpecGeneration's `if (aiEnabled)` gate
 * ignored the deterministic draft's authority entirely, invoking AI spec generation and,
 * on functionalExecution failure, AI repair -- silently replacing the deterministic POM
 * candidate that had already compiled 7/7 (2/2 here) with zero unsupportedCapabilities.
 *
 * No browser: runTypeScriptValidation / runPlaywrightDiscovery / runFunctionalExecution are
 * all supplied via the existing HybridDeps injection seam (the same one
 * spec-generation-hybrid.test.ts already uses throughout), never spawning a real Playwright
 * child process. createProvider is a spy that throws if ever called, so any regression that
 * re-enters the AI path fails loudly instead of silently invoking a real provider.
 */

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function createTmpPaths(): Promise<AppAutomationPaths> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-hybrid-deterministic-authority-"));
  const appDir = path.join(root, "automations", "apps", "test-app");
  const caseDir = path.join(appDir, "cases", "c-det-authority-1");
  await fs.mkdir(caseDir, { recursive: true });
  return {
    appDir,
    configPath: path.join(appDir, "app.config.json"),
    testDataRefsPath: path.join(appDir, "test-data-refs.json"),
    indexPath: path.join(appDir, "index.json"),
    pageObjectsIndexPath: path.join(appDir, "page-objects.index.json"),
    flowsIndexPath: path.join(appDir, "flows.index.json"),
    pagesDir: path.join(appDir, "pages"),
    componentsDir: path.join(appDir, "components"),
    flowsDir: path.join(appDir, "flows"),
    casesDir: path.join(appDir, "cases"),
    caseDir,
    caseConfigPath: path.join(caseDir, "case.json"),
    caseAutomationPath: path.join(caseDir, "automation.json"),
    caseEvidenceDir: path.join(caseDir, "evidence"),
    caseRunsDir: path.join(caseDir, "runs"),
    plansDir: path.join(appDir, "plans"),
    specsDir: path.join(appDir, "specs"),
    evidenceDir: path.join(appDir, "evidence"),
    runsDir: path.join(appDir, "runs"),
    planPath: path.join(caseDir, "plan.json"),
    specPath: path.join(caseDir, "case.spec.ts"),
  };
}

function buildTwoActionPlan(): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-DET-AUTHORITY-1", title: "Deterministic authority through hybrid" },
    requiredData: [],
    steps: [
      { index: 1, action: "fill", description: "Ingresar usuario", target: { strategy: "text", value: "Usuario" }, valueKey: "usuario" },
      { index: 2, action: "click", description: "Clic en Ingresar", target: { strategy: "text", value: "Ingresar" } },
    ],
  };
}

function buildSourceScenario() {
  return {
    title: "Deterministic authority through hybrid",
    steps: [
      { index: 1, action: "Ingresar usuario", technicalTargetRef: "role:textbox|Usuario" },
      { index: 2, action: "Clic en \"Ingresar\"", technicalTargetRef: "role:button|Ingresar" },
    ],
  };
}

function buildProfile(): AppProfile {
  return {
    appSlug: "test-app",
    source: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function passTs() {
  return Promise.resolve({ ok: true, stdout: "", stderr: "", exitCode: 0 });
}
function passList(total = 1) {
  return Promise.resolve({ ok: true, stdout: `Total: ${total} test in 1 file`, stderr: "", exitCode: 0 });
}
function passFunctional(steps = 2, screenshots = 1) {
  return Promise.resolve({
    ok: true,
    stdout: `[evidence] scenario=C-DET-AUTHORITY-1 status=passed steps=${steps} screenshots=${screenshots}`,
    stderr: "",
    exitCode: 0,
    evidenceSteps: steps,
    screenshots,
    authGateDetected: false,
  });
}
function failFunctional() {
  return Promise.resolve({
    ok: false,
    stdout: "",
    stderr: "Promoted click failed at step 2",
    exitCode: 1,
    evidenceSteps: 1,
    screenshots: 0,
    authGateDetected: null,
  });
}

async function buildDeterministicDraft(appPaths: AppAutomationPaths, plan: ExecutionPlan, sourceScenario: ReturnType<typeof buildSourceScenario>) {
  const contract = buildSpecExecutionContract(plan, sourceScenario as any, { appSlug: "test-app", sectionSlug: "default-section" });
  const compiled = compileDeterministicSpec(contract, { targetSpecPath: appPaths.specPath! });
  assert.equal(compiled.unsupportedCapabilities.length, 0, "fixture draft must itself be a valid, fully-supported deterministic candidate");
  return compiled.source;
}

function buildProviderSpy() {
  const calls = { createProvider: 0 };
  const createProvider = async (): Promise<never> => {
    calls.createProvider += 1;
    throw new Error("REGRESSION: createProvider must never be called when candidateAuthority=deterministic_compiler");
  };
  return { calls, createProvider };
}

test("A/deterministic candidate + AI_SPEC_GENERATION_ENABLED=true (real QA Lab config): initial AI generator is not called", async () => {
  const appPaths = await createTmpPaths();
  const plan = buildTwoActionPlan();
  const sourceScenario = buildSourceScenario();
  const deterministicDraft = await buildDeterministicDraft(appPaths, plan, sourceScenario);
  const providerSpy = buildProviderSpy();

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true" }, async () => {
    const result = await runHybridSpecGeneration(
      {
        plan,
        deterministicDraft,
        candidateAuthority: "deterministic_compiler",
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "default-section",
        sourceScenario: sourceScenario as any,
      },
      {
        createProvider: providerSpy.createProvider,
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => passFunctional(2, 1),
      },
    );
    assert.equal(providerSpy.calls.createProvider, 0, "AI provider must never be constructed on the deterministic-authority path");
    assert.equal(result.diagnostics.mode, "deterministic", "mode must stay deterministic, never flip to ai_hybrid");
    assert.equal(result.diagnostics.invocations, 0);
    assert.equal(result.diagnostics.invocationsConsumed, 0);
    assert.equal(result.diagnostics.provider, null);
    assert.equal(result.promotionAllowed, true, "with all gates (including injected functionalExecution) passing, promotion must be allowed");
  });
});

test("B/deterministic candidate + simulated functionalExecution failure: AI repair is not called", async () => {
  const appPaths = await createTmpPaths();
  const plan = buildTwoActionPlan();
  const sourceScenario = buildSourceScenario();
  const deterministicDraft = await buildDeterministicDraft(appPaths, plan, sourceScenario);
  const providerSpy = buildProviderSpy();

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true" }, async () => {
    const result = await runHybridSpecGeneration(
      {
        plan,
        deterministicDraft,
        candidateAuthority: "deterministic_compiler",
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "default-section",
        sourceScenario: sourceScenario as any,
      },
      {
        createProvider: providerSpy.createProvider,
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => failFunctional(),
      },
    );
    assert.equal(providerSpy.calls.createProvider, 0, "AI repair must never construct a provider on the deterministic-authority path");
    assert.equal(result.diagnostics.specRepairAttempts, 0, "no repair recursion must have occurred");
    assert.equal(result.diagnostics.invocations, 0);
    assert.equal(result.diagnostics.validation.functionalExecution, "failed");
    assert.equal(result.promotionAllowed, false);
  });
});

test("C/hybrid output preserves the deterministic candidate (structurally unchanged; only approved infra rewrites applied)", async () => {
  const appPaths = await createTmpPaths();
  const plan = buildTwoActionPlan();
  const sourceScenario = buildSourceScenario();
  const deterministicDraft = await buildDeterministicDraft(appPaths, plan, sourceScenario);

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true" }, async () => {
    const result = await runHybridSpecGeneration(
      {
        plan,
        deterministicDraft,
        candidateAuthority: "deterministic_compiler",
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "default-section",
        sourceScenario: sourceScenario as any,
      },
      {
        createProvider: buildProviderSpy().createProvider,
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => passFunctional(2, 1),
      },
    );
    assert.match(result.specContent, /class DeterministicPromotedPage \{/, "hybrid output must still be the deterministic POM candidate");
    assert.match(result.specContent, /pageObject\.fill\(/);
    assert.match(result.specContent, /pageObject\.click\(/);
    assert.equal(result.diagnostics.finalSpec.origin, "deterministic_compiler");
  });
});

test("D/metadata: aiInvoked-equivalent counters are zero on the deterministic-authority path", async () => {
  const appPaths = await createTmpPaths();
  const plan = buildTwoActionPlan();
  const sourceScenario = buildSourceScenario();
  const deterministicDraft = await buildDeterministicDraft(appPaths, plan, sourceScenario);

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true" }, async () => {
    const result = await runHybridSpecGeneration(
      {
        plan,
        deterministicDraft,
        candidateAuthority: "deterministic_compiler",
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "default-section",
        sourceScenario: sourceScenario as any,
      },
      {
        createProvider: buildProviderSpy().createProvider,
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => passFunctional(2, 1),
      },
    );
    assert.equal(result.diagnostics.invocations, 0, "aiInvoked-equivalent");
    assert.equal(result.diagnostics.specGenerationAttempts, 0, "aiAttempts-equivalent");
    assert.equal(result.diagnostics.specRepairAttempts, 0);
  });
});

test("E/gate failure keeps deterministic_compiler authority: no fallback, no replacement", async () => {
  const appPaths = await createTmpPaths();
  const plan = buildTwoActionPlan();
  const sourceScenario = buildSourceScenario();
  const deterministicDraft = await buildDeterministicDraft(appPaths, plan, sourceScenario);

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true" }, async () => {
    const result = await runHybridSpecGeneration(
      {
        plan,
        deterministicDraft,
        candidateAuthority: "deterministic_compiler",
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "default-section",
        sourceScenario: sourceScenario as any,
      },
      {
        createProvider: buildProviderSpy().createProvider,
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => failFunctional(),
      },
    );
    assert.equal(result.diagnostics.validation.functionalExecution, "failed");
    assert.equal(result.promotionAllowed, false);
    assert.equal(result.diagnostics.mode, "deterministic", "candidate authority must remain deterministic, never flip to ai_hybrid");
    assert.equal(result.diagnostics.finalSpec.origin, "deterministic_compiler", "finalSpecOrigin must not become ai_candidate on gate failure");
    assert.match(result.specContent, /class DeterministicPromotedPage \{/, "no legacy/ai fallback replacement occurred");
  });
});
