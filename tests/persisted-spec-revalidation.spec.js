"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const persisted_spec_revalidation_1 = require("../src/automations/persisted-spec-revalidation");
const promote_plan_1 = require("../src/automations/promote-plan");
const app_profile_1 = require("../src/automations/app-profile");
const automation_naming_1 = require("../src/automations/automation-naming");
const automation_promotion_types_1 = require("../src/types/automation-promotion.types");
async function makeCase(root, plan) {
    const dir = node_path_1.default.join(root, "automations", "apps", "app-a", "sections", "section-a", "cases", "case-a");
    await promises_1.default.mkdir(dir, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(dir, "case.spec.ts"), "spec", "utf8");
    await promises_1.default.writeFile(node_path_1.default.join(dir, "plan.json"), JSON.stringify(plan), "utf8");
    await promises_1.default.writeFile(node_path_1.default.join(dir, "automation.json"), JSON.stringify({ appSlug: "app-a", caseId: 1 }), "utf8");
    return dir;
}
(0, test_1.test)("loads persisted context and drives the deterministic revalidator", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "persisted-revalidation");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const dir = await makeCase(root, { sourceScenario: { steps: [], observableOracles: [] }, executionContract: { steps: [], unresolvedRequiredOracles: [] } });
    const context = await (0, persisted_spec_revalidation_1.loadExistingSpecRevalidationContext)({ caseDir: dir, appSlug: "app-a", sectionSlug: "section-a", caseId: 1 });
    (0, test_1.expect)(context.identityValidated).toBe(true);
    const result = await (0, persisted_spec_revalidation_1.revalidatePersistedExistingSpec)({ caseDir: dir, appSlug: "app-a", sectionSlug: "section-a", caseId: 1, semanticContext: { requiredAssertions: [], observableOracles: [], scenarioSteps: [] }, runTypeScriptValidation: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }), runPlaywrightDiscovery: async () => ({ ok: true, stdout: "1 test", stderr: "", exitCode: 0 }) });
    (0, test_1.expect)(result.status).toBe("passed");
    await promises_1.default.rm(root, { recursive: true, force: true });
});
(0, test_1.test)("does not invent a missing source scenario", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "persisted-revalidation-missing");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const dir = await makeCase(root, { executionContract: { steps: [], unresolvedRequiredOracles: [] } });
    const result = await (0, persisted_spec_revalidation_1.revalidatePersistedExistingSpec)({ caseDir: dir, appSlug: "app-a", caseId: 1 });
    (0, test_1.expect)(result.status).toBe("insufficient_context");
    (0, test_1.expect)(result.context.missingContextFields).toContain("sourceScenario");
    await promises_1.default.rm(root, { recursive: true, force: true });
});
(0, test_1.test)("promotes and round-trips the authoritative revalidation context", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "persisted-revalidation-promotion");
    await promises_1.default.rm(root, { recursive: true, force: true });
    const plan = {
        version: "1.0", source: "discovery_generated", status: "validated", createdAt: new Date().toISOString(),
        scenario: { source: "manual", externalId: "C42940", caseId: 42940, title: "Context round trip" },
        requiredData: [], steps: [{ index: 1, action: "click", description: "Iniciar", target: { strategy: "text", value: "Iniciar" } }]
    };
    const sourceScenario = { title: plan.scenario.title, steps: [{ index: 1, action: "click", description: "Iniciar" }] };
    const appProfile = { appSlug: "app-a", source: "default", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const previousAiEnabled = process.env.AI_ENABLED;
    process.env.AI_ENABLED = "false";
    try {
        await (0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: root, appProfileObject: appProfile, source: "discovery", sectionSlug: "section-a", inlineDebugMode: true, promotionPolicy: { ...automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, specMode: "inline-debug", requirePageObjects: false, allowInlineFallback: true, blockPromotionWhenPageObjectMissing: false }, sourceScenario });
    }
    finally {
        if (previousAiEnabled === undefined)
            delete process.env.AI_ENABLED;
        else
            process.env.AI_ENABLED = previousAiEnabled;
    }
    const automationId = (0, automation_naming_1.buildAutomationId)({ externalId: plan.scenario.externalId, caseId: plan.scenario.caseId, title: plan.scenario.title });
    const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, automationId, root, "section-a");
    const persisted = JSON.parse(await promises_1.default.readFile(appPaths.planPath, "utf8"));
    await promises_1.default.writeFile(appPaths.specPath, "export {};", "utf8");
    (0, test_1.expect)(persisted.sourceScenario).toEqual(sourceScenario);
    (0, test_1.expect)(persisted.executionContract).toBeTruthy();
    (0, test_1.expect)(persisted.scenario).toEqual(plan.scenario);
    (0, test_1.expect)(persisted.steps).toEqual(plan.steps);
    const context = await (0, persisted_spec_revalidation_1.loadExistingSpecRevalidationContext)({ caseDir: appPaths.caseDir, appSlug: "app-a", sectionSlug: "section-a", caseId: 42940 });
    (0, test_1.expect)(context.sourceScenario).toEqual(persisted.sourceScenario);
    (0, test_1.expect)(context.executionContract).toEqual(persisted.executionContract);
    (0, test_1.expect)(context.missingContextFields).toEqual([]);
    await promises_1.default.rm(root, { recursive: true, force: true });
});
