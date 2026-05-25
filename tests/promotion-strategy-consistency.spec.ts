import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { config as envConfig } from "../src/config/env";
import { promoteExecutionPlan } from "../src/automations/promote-plan";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { PromotionPolicy } from "../src/types/automation-promotion.types";
import { deriveAppProfile } from "../src/automations/app-profile";

function basePlan(title: string): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "manual", title },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Continue" } }],
    createdAt: new Date().toISOString()
  };
}

test("fallback inline registra diagnostics estructurados", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", `promo-strategy-${Date.now()}`);
  const policy: PromotionPolicy = {
    specMode: "page-object",
    requirePageObjects: false,
    allowInlineFallback: true,
    allowInlineDebugMode: true,
    allowCandidateGeneration: false,
    blockPromotionWhenPageObjectMissing: false
  };
  const appProfile = deriveAppProfile({ appProfile: "strategy-inline-test", baseUrl: envConfig.app.baseUrl });
  const entry = await promoteExecutionPlan({
    plan: basePlan("inline strategy fallback"),
    overwrite: true,
    outputRoot: root,
    promotionPolicy: policy,
    fullConfig: envConfig,
    appProfileObject: appProfile
  });
  const caseDir = path.dirname(entry.planPath);
  const diagnosticsPath = path.join(caseDir, "promotion-diagnostics.json");
  const raw = await fs.readFile(diagnosticsPath, "utf-8");
  const diagnostics = JSON.parse(raw) as Record<string, unknown>;
  expect(diagnostics.requestedStrategy).toBe("pom");
  expect(diagnostics.selectedStrategy).toBe("inline");
  expect(diagnostics.fallbackUsed).toBe(true);
  expect(String(diagnostics.reason)).toContain("pom_unavailable");
});

test("require pom runtime falla cuando no disponible", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", `promo-require-pom-${Date.now()}`);
  const policy: PromotionPolicy = {
    specMode: "page-object",
    requirePageObjects: false,
    allowInlineFallback: true,
    allowInlineDebugMode: true,
    allowCandidateGeneration: false,
    blockPromotionWhenPageObjectMissing: false
  };
  const appProfile = deriveAppProfile({ appProfile: "strategy-require-pom-test", baseUrl: envConfig.app.baseUrl });
  await expect(promoteExecutionPlan({
    plan: basePlan("require pom runtime"),
    overwrite: true,
    outputRoot: root,
    promotionPolicy: policy,
    fullConfig: envConfig,
    appProfileObject: appProfile,
    requirePomRuntime: true
  })).rejects.toThrow(/POM_RUNTIME_REQUIRED_BUT_UNAVAILABLE/);
});

test("spec marker pom e inline", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", `promo-marker-${Date.now()}`);
  const inlinePolicy: PromotionPolicy = {
    specMode: "inline-debug",
    requirePageObjects: false,
    allowInlineFallback: true,
    allowInlineDebugMode: true,
    allowCandidateGeneration: false,
    blockPromotionWhenPageObjectMissing: false
  };
  const appInline = deriveAppProfile({ appProfile: "strategy-marker-inline", baseUrl: envConfig.app.baseUrl });
  const inlineEntry = await promoteExecutionPlan({
    plan: basePlan("inline marker"),
    overwrite: true,
    outputRoot: root,
    promotionPolicy: inlinePolicy,
    fullConfig: envConfig,
    appProfileObject: appInline,
    inlineDebugMode: true
  });
  const inlineSpec = await fs.readFile(inlineEntry.specPath, "utf-8");
  expect(inlineSpec).toContain(`PROMOTED_SPEC_STRATEGY = "inline_executor"`);
});
