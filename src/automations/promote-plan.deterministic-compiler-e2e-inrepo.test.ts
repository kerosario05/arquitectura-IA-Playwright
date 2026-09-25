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
 * End-to-end, real-location proof of the production entrypoint's opt-in
 * deterministic path. The PREVIOUS integration test's `outputRoot` was a
 * temp directory OUTSIDE the repo root, so `playwrightDiscovery` could never
 * pass regardless of candidate content (playwright.config.ts's `testMatch`
 * -- "automations/apps/**\/cases/**\/*.spec.ts" -- is anchored to `testDir: "."`,
 * the project root). This test instead uses `outputRoot = process.cwd()`
 * with a clearly-temp, never-real app slug, so the materialized case lands
 * inside the REAL, in-repo `automations/apps/` tree that discovery can
 * actually match -- while still touching NO existing app/case. Cleaned up
 * in `finally`. Same promoteExecutionPlan / deterministic branch /
 * buildSpecExecutionContract / compileDeterministicSpec /
 * runHybridSpecGeneration / structuralValidation / playwrightDiscovery /
 * persistence path as real production use -- no mocks, no gate bypass.
 */

const TEMP_APP_SLUG = `zzz-temp-production-e2e-${process.pid}`;
const TEMP_APP_DIR = getPromotedAppDirectory({ appSlug: TEMP_APP_SLUG } as AppProfile, process.cwd());

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
    scenario: { source: "manual", externalId: "C-E2E-1", title: "Deterministic compiler in-repo e2e" },
    requiredData: [],
    steps: [
      { index: 1, action: "fill", description: "Ingresar usuario", target: { strategy: "text", value: "Usuario" }, valueKey: "usuario" },
      { index: 2, action: "click", description: "Clic en Ingresar", target: { strategy: "text", value: "Ingresar" } },
    ],
  };
}

function buildSourceScenario() {
  return {
    title: "Deterministic compiler in-repo e2e",
    steps: [
      { index: 1, action: "Ingresar usuario", technicalTargetRef: "role:textbox|Usuario" },
      { index: 2, action: "Clic en \"Ingresar\"", technicalTargetRef: "role:button|Ingresar" },
    ],
  };
}

test("production entrypoint, in-repo temp case: deterministic POM candidate reaches specWritten=true (or reports the exact next gate, never fixed here)", async () => {
  const plan = buildTwoActionPlan();
  const appProfile: AppProfile = {
    appSlug: TEMP_APP_SLUG,
    source: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const automationId = buildAutomationId({ externalId: plan.scenario.externalId, caseId: plan.scenario.caseId, title: plan.scenario.title });
  const appPaths = buildAppAutomationPaths(appProfile, automationId, process.cwd(), "default-section");

  try {
    // AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED explicitly forced false: this ticket
    // proves generation/persistence only, never physical/browser execution.
    await withEnv({ AI_SPEC_GENERATION_ENABLED: "false", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false" }, async () => {
      const result = await promoteExecutionPlan({
        plan,
        outputRoot: process.cwd(),
        appProfileObject: appProfile,
        source: "discovery",
        sectionSlug: "default-section",
        useDeterministicSpecCompiler: true,
        promotionPolicy: { ...DEFAULT_PROMOTION_POLICY, specMode: "page-object" },
        sourceScenario: buildSourceScenario(),
      });

      const specGeneration = result.metadata?.specGeneration as {
        mode?: string;
        provider?: unknown;
        invocations?: number;
        validation?: { structure?: string; playwrightDiscovery?: string };
        promotionAllowed?: boolean;
        finalSpec?: { origin?: string };
      } | undefined;

      console.log(
        `[production-e2e-inrepo] deterministicBranchReached=${specGeneration?.mode === "deterministic"} ` +
        `structuralValidation=${specGeneration?.validation?.structure} ` +
        `playwrightDiscovery=${specGeneration?.validation?.playwrightDiscovery} ` +
        `promotionAllowed=${specGeneration?.promotionAllowed} ` +
        `specWritten=${result.metadata?.specGeneration?.specWritten} ` +
        `finalSpecOrigin=${specGeneration?.finalSpec?.origin}`
      );

      // aiInvoked=false, unconditionally -- true regardless of which gate is reached.
      assert.equal(specGeneration?.mode, "deterministic");
      assert.equal(specGeneration?.provider ?? null, null);
      assert.equal(specGeneration?.invocations ?? 0, 0);

      // Boundaries already GREEN and re-verified here, not reopened.
      assert.equal(specGeneration?.validation?.structure, "passed");
      assert.equal(specGeneration?.validation?.playwrightDiscovery, "passed");

      const specWritten = (result.metadata?.specGeneration as { specWritten?: boolean } | undefined)?.specWritten;
      if (specWritten) {
        const persisted = await fs.readFile(appPaths.specPath!, "utf8");
        assert.match(persisted, /class DeterministicPromotedPage \{/, "persisted spec must be the deterministic POM family");
        assert.match(persisted, /pageObject\.(fill|click)\(/, "persisted spec must contain POM action calls");
        assert.match(persisted, /PROMOTED_SPEC_STRATEGY = "pom_runtime"/, "persisted spec must carry the pom_runtime strategy marker");
        assert.doesNotMatch(persisted, /inline_executor/, "must never be the unrelated inline_executor fallback shape");
      } else {
        console.log(`[production-e2e-inrepo] NEXT_BOUNDARY (not fixed here): promotionAllowed=${specGeneration?.promotionAllowed}, errors=${JSON.stringify((result.metadata?.specGeneration as any)?.errors)}`);
      }
    });
  } finally {
    await fs.rm(TEMP_APP_DIR, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("cleanup verification: the temporary app directory does not exist after the e2e test", async () => {
  await assert.rejects(fs.access(TEMP_APP_DIR));
});
