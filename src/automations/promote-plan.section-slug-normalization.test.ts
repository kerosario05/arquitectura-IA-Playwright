import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promoteExecutionPlan } from "./promote-plan";
import { buildAutomationId } from "./automation-naming";
import { buildAppAutomationPaths, getPromotedAppDirectory, type AppProfile } from "./app-profile";
import type { ExecutionPlan } from "../types/execution-plan.types";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";

/**
 * Proves the FIRST_LOSS fix: promoteExecutionPlan now normalizes sectionSlug ONCE, upstream of
 * the deterministic branch's buildSpecExecutionContract call, so the deterministic compiler
 * receives the same "default-section" fallback that buildAppAutomationPaths and
 * spec-generation-hybrid.ts's structuralValidation expectation already applied independently --
 * closing the mismatch that previously produced missing_metadata_line:SECTION_SLUG for jobs
 * where QA Lab sends no explicit section. Uses the real production entrypoint
 * (promoteExecutionPlan, useDeterministicSpecCompiler=true) against an in-repo temp case, same
 * pattern as promote-plan.deterministic-compiler-e2e-inrepo.test.ts -- no mocks, no gate bypass,
 * no browser (AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED forced false).
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

function buildTwoActionPlan(externalId: string): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId, title: "Section slug normalization" },
    requiredData: [],
    steps: [
      { index: 1, action: "fill", description: "Ingresar usuario", target: { strategy: "text", value: "Usuario" }, valueKey: "usuario" },
      { index: 2, action: "click", description: "Clic en Ingresar", target: { strategy: "text", value: "Ingresar" } },
    ],
  };
}

function buildSourceScenario() {
  return {
    title: "Section slug normalization",
    steps: [
      { index: 1, action: "Ingresar usuario", technicalTargetRef: "role:textbox|Usuario" },
      { index: 2, action: "Clic en \"Ingresar\"", technicalTargetRef: "role:button|Ingresar" },
    ],
  };
}

type SpecGenerationMeta = {
  mode?: string;
  provider?: unknown;
  invocations?: number;
  validation?: { structure?: string; playwrightDiscovery?: string };
  errors?: string[];
  finalSpec?: { origin?: string };
  specGenerationAttempts?: number;
  specRepairAttempts?: number;
};

async function runNormalizationCase(
  externalId: string,
  inputSectionSlug: string | undefined,
  expectedSectionSlug: string,
) {
  const tempAppSlug = `zzz-temp-section-slug-${externalId.toLowerCase()}-${process.pid}`;
  const tempAppDir = getPromotedAppDirectory({ appSlug: tempAppSlug } as AppProfile, process.cwd());
  const plan = buildTwoActionPlan(externalId);
  const appProfile: AppProfile = {
    appSlug: tempAppSlug,
    source: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const automationId = buildAutomationId({ externalId: plan.scenario.externalId, caseId: plan.scenario.caseId, title: plan.scenario.title });
  const appPaths = buildAppAutomationPaths(appProfile, automationId, process.cwd(), expectedSectionSlug);

  try {
    await withEnv({ AI_SPEC_GENERATION_ENABLED: "false", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false" }, async () => {
      const result = await promoteExecutionPlan({
        plan,
        outputRoot: process.cwd(),
        appProfileObject: appProfile,
        source: "discovery",
        sectionSlug: inputSectionSlug,
        useDeterministicSpecCompiler: true,
        promotionPolicy: { ...DEFAULT_PROMOTION_POLICY, specMode: "page-object" },
        sourceScenario: buildSourceScenario(),
      });

      const specGeneration = result.metadata?.specGeneration as SpecGenerationMeta | undefined;
      assert.equal(specGeneration?.mode, "deterministic", "candidateAuthority must still route through the deterministic branch");
      assert.equal(specGeneration?.provider ?? null, null);
      assert.equal(specGeneration?.invocations ?? 0, 0, "TEST F: initial AI generation calls must be 0");
      assert.equal(specGeneration?.specRepairAttempts ?? 0, 0, "TEST F: AI repair calls must be 0");
      assert.equal(specGeneration?.finalSpec?.origin, "deterministic_compiler", "TEST F: finalSpecOrigin must be deterministic_compiler");

      // promotionAllowed stays false here (functionalExecution is deferred, not part of this
      // ticket's scope), so the FINAL case.spec.ts is never written -- read the candidate
      // instead, which reflects the deterministic compiler's output regardless of promotion
      // outcome (same artifact spec-generation-hybrid.ts always persists for inspection).
      const candidateSpecPath = path.join(appPaths.caseDir!, "spec-generation", "candidate.spec.ts");
      const persisted = await fs.readFile(candidateSpecPath, "utf8");
      assert.match(
        persisted,
        new RegExp(`process\\.env\\.SECTION_SLUG = '${expectedSectionSlug}';`),
        `TEST D: generated source must contain the exact normalized SECTION_SLUG line`,
      );

      assert.equal(
        specGeneration?.validation?.structure,
        "passed",
        "TEST E: structuralValidation must pass now that SECTION_SLUG metadata is present",
      );
      assert.ok(
        !(specGeneration?.errors ?? []).some((e) => e === "missing_metadata_line:SECTION_SLUG"),
        "TEST E: missing_metadata_line:SECTION_SLUG must be gone",
      );
    });
  } finally {
    await fs.rm(tempAppDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test("A/missing section (sectionSlug omitted): deterministic contract normalizes to default-section", async () => {
  await runNormalizationCase("C-SECTION-A", undefined, "default-section");
});

test("B/empty-whitespace section (sectionSlug=\" \"): normalizes to default-section", async () => {
  await runNormalizationCase("C-SECTION-B", " ", "default-section");
});

test("C/explicit section: preserved exactly, never replaced by the default", async () => {
  await runNormalizationCase("C-SECTION-C", "automatizacion-1", "automatizacion-1");
});
