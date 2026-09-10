import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loadExistingSpecRevalidationContext, revalidatePersistedExistingSpec } from "../src/automations/persisted-spec-revalidation";
import { promoteExecutionPlan } from "../src/automations/promote-plan";
import { buildAppAutomationPaths, type AppProfile } from "../src/automations/app-profile";
import { buildAutomationId } from "../src/automations/automation-naming";
import { DEFAULT_PROMOTION_POLICY } from "../src/types/automation-promotion.types";

async function makeCase(root: string, plan: Record<string, unknown>) {
  const dir = path.join(root, "automations", "apps", "app-a", "sections", "section-a", "cases", "case-a");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "case.spec.ts"), "spec", "utf8");
  await fs.writeFile(path.join(dir, "plan.json"), JSON.stringify(plan), "utf8");
  await fs.writeFile(path.join(dir, "automation.json"), JSON.stringify({ appSlug: "app-a", caseId: 1 }), "utf8");
  return dir;
}

test("loads persisted context and drives the deterministic revalidator", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "persisted-revalidation");
  await fs.rm(root, { recursive: true, force: true });
  const dir = await makeCase(root, { sourceScenario: { steps: [], observableOracles: [] }, executionContract: { steps: [], unresolvedRequiredOracles: [] } });
  const context = await loadExistingSpecRevalidationContext({ caseDir: dir, appSlug: "app-a", sectionSlug: "section-a", caseId: 1 });
  expect(context.identityValidated).toBe(true);
  const result = await revalidatePersistedExistingSpec({ caseDir: dir, appSlug: "app-a", sectionSlug: "section-a", caseId: 1, semanticContext: { requiredAssertions: [], observableOracles: [], scenarioSteps: [] }, runTypeScriptValidation: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }), runPlaywrightDiscovery: async () => ({ ok: true, stdout: "1 test", stderr: "", exitCode: 0 }) } as any);
  expect(result.status).toBe("passed");
  await fs.rm(root, { recursive: true, force: true });
});

test("does not invent a missing source scenario", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "persisted-revalidation-missing");
  await fs.rm(root, { recursive: true, force: true });
  const dir = await makeCase(root, { executionContract: { steps: [], unresolvedRequiredOracles: [] } });
  const result = await revalidatePersistedExistingSpec({ caseDir: dir, appSlug: "app-a", caseId: 1 } as any);
  expect(result.status).toBe("insufficient_context");
  expect(result.context.missingContextFields).toContain("sourceScenario");
  await fs.rm(root, { recursive: true, force: true });
});

test("promotes and round-trips the authoritative revalidation context", async () => {
  const root = path.join(process.cwd(), ".artifacts", "tmp", "persisted-revalidation-promotion");
  await fs.rm(root, { recursive: true, force: true });
  const plan = {
    version: "1.0", source: "discovery_generated", status: "validated", createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C42940", caseId: 42940, title: "Context round trip" },
    requiredData: [], steps: [{ index: 1, action: "click", description: "Iniciar", target: { strategy: "text", value: "Iniciar" } }]
  } as any;
  const sourceScenario = { title: plan.scenario.title, steps: [{ index: 1, action: "click", description: "Iniciar" }] };
  const appProfile: AppProfile = { appSlug: "app-a", source: "default", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const previousAiEnabled = process.env.AI_ENABLED;
  process.env.AI_ENABLED = "false";
  try {
    await promoteExecutionPlan({ plan, outputRoot: root, appProfileObject: appProfile, source: "discovery", sectionSlug: "section-a", inlineDebugMode: true, promotionPolicy: { ...DEFAULT_PROMOTION_POLICY, specMode: "inline-debug", requirePageObjects: false, allowInlineFallback: true, blockPromotionWhenPageObjectMissing: false }, sourceScenario });
  } finally {
    if (previousAiEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previousAiEnabled;
  }
  const automationId = buildAutomationId({ externalId: plan.scenario.externalId, caseId: plan.scenario.caseId, title: plan.scenario.title });
  const appPaths = buildAppAutomationPaths(appProfile, automationId, root, "section-a");
  const persisted = JSON.parse(await fs.readFile(appPaths.planPath, "utf8"));
  await fs.writeFile(appPaths.specPath, "export {};", "utf8");
  expect(persisted.sourceScenario).toEqual(sourceScenario);
  expect(persisted.executionContract).toBeTruthy();
  expect(persisted.scenario).toEqual(plan.scenario);
  expect(persisted.steps).toEqual(plan.steps);
  const context = await loadExistingSpecRevalidationContext({ caseDir: appPaths.caseDir!, appSlug: "app-a", sectionSlug: "section-a", caseId: 42940 });
  expect(context.sourceScenario).toEqual(persisted.sourceScenario);
  expect(context.executionContract).toEqual(persisted.executionContract);
  expect(context.missingContextFields).toEqual([]);
  await fs.rm(root, { recursive: true, force: true });
});
