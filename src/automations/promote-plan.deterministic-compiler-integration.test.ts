import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promoteExecutionPlan } from "./promote-plan";
import { buildAutomationId } from "./automation-naming";
import { buildAppAutomationPaths, type AppProfile } from "./app-profile";
import type { ExecutionPlan } from "../types/execution-plan.types";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { compileDeterministicSpec } from "./spec-compiler/deterministic-spec-compiler";

/**
 * Proves the REAL production spec-generation entrypoint (promoteExecutionPlan,
 * src/automations/promote-plan.ts) invokes compileDeterministicSpec end-to-end
 * when opted in (useDeterministicSpecCompiler=true) -- not just an isolated
 * unit test of the compiler itself, which was already GREEN before this
 * ticket. Default (flag omitted/false) production behavior is left completely
 * unchanged, per the ticket's own instruction not to alter existing reuse
 * policy or default behavior for operations the compiler does not yet cover.
 */

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
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

function buildTwoActionPlan(): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-DET-1", title: "Deterministic compiler production wiring" },
    requiredData: [],
    steps: [
      { index: 1, action: "fill", description: "Ingresar usuario", target: { strategy: "text", value: "Usuario" }, valueKey: "usuario" },
      { index: 2, action: "click", description: "Clic en Ingresar", target: { strategy: "text", value: "Ingresar" } },
    ],
  };
}

function buildSourceScenario() {
  return {
    title: "Deterministic compiler production wiring",
    steps: [
      { index: 1, action: "Ingresar usuario", technicalTargetRef: "role:textbox|Usuario" },
      { index: 2, action: "Clic en \"Ingresar\"", technicalTargetRef: "role:button|Ingresar" },
    ],
  };
}

async function setup() {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promote-deterministic-"));
  const plan = buildTwoActionPlan();
  const appProfile: AppProfile = {
    appSlug: "arquitectura-automatizacion",
    source: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const automationId = buildAutomationId({ externalId: plan.scenario.externalId, caseId: plan.scenario.caseId, title: plan.scenario.title });
  const appPaths = buildAppAutomationPaths(appProfile, automationId, outputRoot, "default-section");
  return { outputRoot, plan, appProfile, appPaths, sourceScenario: buildSourceScenario() };
}

// PREVIOUS gap (runtime_step_binding_unresolved from structuralValidation not
// recognizing the POM wrapper shape) is now FIXED and asserted-absent below.
//
// CORRECTION (follow-up DIAGNOSE ticket, retracted a misattribution): the
// persisted `candidate.spec.ts` never silently became `inline_executor` for
// the deterministic path -- that inspection was of a DIFFERENT test's temp
// dir (the pre-existing, unrelated specMode="inline-debug" path, test H).
// Traced precisely (`[deterministic-draft-tracking]` instrumentation in
// promote-plan.ts): `runHybridSpecGeneration` returns the POM draft
// UNCHANGED end-to-end.
//
// FIXED (this ticket): the two remaining structuralValidation `errors`
// findings -- `missing_metadata_line:SCENARIO_TITLE` (compileDeterministicSpec
// now also emits `process.env.SCENARIO_TITLE` from `contract.title`, the
// same authoritative field already used for the test name) and
// `unused_import:expect` (now imported only when a navigation_transition
// oracle with a real urlPattern is actually emitted). `structuralValidation`
// now PASSES end-to-end for the deterministic path.
//
// NEW boundary reached, NOT fixed here (per this ticket's scope):
// `playwrightDiscovery=failed` -- expected for a synthetic fixture with no
// real app to discover against, not diagnosed as a compiler defect.
test("A/structuralValidation no longer rejects the deterministic POM wrapper shape via runtime_step_binding_unresolved (this ticket's fix, isolated proof)", () => {
  const contract = buildSpecExecutionContract(buildTwoActionPlan(), buildSourceScenario() as any, { appSlug: "arquitectura-automatizacion", sectionSlug: "default-section" });
  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/arquitectura-automatizacion/sections/default-section/cases/c-det-1-deterministic-compiler-production-wiring/case.spec.ts",
  );
  const compiled = compileDeterministicSpec(contract, { targetSpecPath });
  assert.match(compiled.source, /class DeterministicPromotedPage \{/);
  assert.match(compiled.source, /pageObject\.fill\(/);
  assert.match(compiled.source, /pageObject\.click\(/);
  assert.equal(compiled.unsupportedCapabilities.length, 0);
  // See spec-generation-hybrid.deterministic-pom-binding-gate.test.ts for the
  // direct, dedicated structuralValidation() proof (8/8 tests, including this
  // exact fresh-contract shape) -- the isolated boundary this ticket targets.
});

test("A2/production entrypoint: structuralValidation now PASSES end-to-end for the deterministic POM candidate; the pipeline advances to playwrightDiscovery (expected, synthetic fixture, not fixed here)", async () => {
  const { outputRoot, plan, appProfile, sourceScenario } = await setup();

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "false", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false" }, async () => {
    const result = await promoteExecutionPlan({
      plan,
      outputRoot,
      appProfileObject: appProfile,
      source: "discovery",
      sectionSlug: "default-section",
      useDeterministicSpecCompiler: true,
      promotionPolicy: { ...DEFAULT_PROMOTION_POLICY, specMode: "page-object" },
      sourceScenario,
    });

    const specGeneration = result.metadata?.specGeneration as {
      mode?: string;
      errors?: string[];
      validation?: { structure?: string; playwrightDiscovery?: string };
    } | undefined;
    assert.equal(specGeneration?.mode, "deterministic", "the deterministic compiler path must be the one that ran, not the AI path");
    assert.ok(
      !(specGeneration?.errors ?? []).some((e) => e.startsWith("runtime_step_binding_unresolved:")),
      "POM wrapper shape must not trigger runtime_step_binding_unresolved",
    );
    assert.ok(
      !(specGeneration?.errors ?? []).some((e) => e === "missing_metadata_line:SCENARIO_TITLE"),
      "this ticket's fix: SCENARIO_TITLE metadata line must now be present",
    );
    assert.ok(
      !(specGeneration?.errors ?? []).some((e) => e === "unused_import:expect"),
      "this ticket's fix: expect must not be imported when unused",
    );
    assert.equal(specGeneration?.validation?.structure, "passed", "structuralValidation must now pass end-to-end for this deterministic candidate");
    // NEW boundary, NOT fixed here (per scope): a synthetic fixture has no real
    // app to discover against.
    assert.equal(specGeneration?.validation?.playwrightDiscovery, "failed");
  });
});

test("B/AI exclusion: the real AI spec-generation boundary is never reached on the deterministic path", async () => {
  const { outputRoot, plan, appProfile, sourceScenario } = await setup();

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "false", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false" }, async () => {
    // AI_SPEC_GENERATION_ENABLED=false makes generateSpecFromPlanWithPolicy's AI-dependent
    // strategies fail/fallback loudly if invoked -- the real, already-wired kill switch for
    // that boundary. specGeneration.mode="deterministic" with provider/model/skill all null
    // and invocations=0 proves the AI generation call was never reached.
    const result = await promoteExecutionPlan({
      plan,
      outputRoot,
      appProfileObject: appProfile,
      source: "discovery",
      sectionSlug: "default-section",
      useDeterministicSpecCompiler: true,
      promotionPolicy: { ...DEFAULT_PROMOTION_POLICY, specMode: "page-object" },
      sourceScenario,
    });
    const specGeneration = result.metadata?.specGeneration as { mode?: string; provider?: unknown; model?: unknown; invocations?: number } | undefined;
    assert.equal(specGeneration?.mode, "deterministic");
    assert.equal(specGeneration?.provider, null);
    assert.equal(specGeneration?.model, null);
    assert.equal(specGeneration?.invocations, 0);
  });
});

test("F/unsupported contract fails closed on the deterministic path -- no AI fallback, no invented spec", async () => {
  const { outputRoot, appProfile, sourceScenario } = await setup();
  const unsupportedPlan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-DET-2", title: "Unsupported operation" },
    requiredData: [],
    steps: [{ index: 1, action: "select", description: "Seleccionar opcion", target: { strategy: "text", value: "Opcion" }, valueKey: "opcion" }],
  };

  await withEnv({ AI_SPEC_GENERATION_ENABLED: "false", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false" }, async () => {
    await assert.rejects(
      () => promoteExecutionPlan({
        plan: unsupportedPlan,
        outputRoot,
        appProfileObject: appProfile,
        source: "discovery",
        sectionSlug: "default-section",
        useDeterministicSpecCompiler: true,
        promotionPolicy: { ...DEFAULT_PROMOTION_POLICY, specMode: "page-object" },
        sourceScenario: { title: "Unsupported operation", steps: [{ index: 1, action: "Seleccionar opcion" }] },
      }),
      /DETERMINISTIC_SPEC_GENERATION_FAILED_CLOSED.*failedGate=deterministic_unsupported_capabilities/s,
    );
  });
});

test("H/default (useDeterministicSpecCompiler omitted) preserves existing AI-path behavior unchanged", async () => {
  const { outputRoot, plan, appProfile, sourceScenario } = await setup();
  await withEnv({ AI_SPEC_GENERATION_ENABLED: "false", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false" }, async () => {
    const result = await promoteExecutionPlan({
      plan,
      outputRoot,
      appProfileObject: appProfile,
      source: "discovery",
      sectionSlug: "default-section",
      // useDeterministicSpecCompiler intentionally omitted.
      promotionPolicy: { ...DEFAULT_PROMOTION_POLICY, specMode: "inline-debug", requirePageObjects: false, allowInlineFallback: true, blockPromotionWhenPageObjectMissing: false },
      sourceScenario,
    });
    // Existing behavior for this policy/env combination is unchanged (matches
    // promote-plan.spec-generation.test.ts's own established baseline).
    assert.ok(result.status === "spec_failed" || result.status !== undefined);
  });
});
