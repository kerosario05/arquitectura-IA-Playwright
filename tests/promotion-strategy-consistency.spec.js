"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const env_1 = require("../src/config/env");
const promote_plan_1 = require("../src/automations/promote-plan");
const app_profile_1 = require("../src/automations/app-profile");
function basePlan(title) {
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
(0, test_1.test)("fallback inline registra diagnostics estructurados", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", `promo-strategy-${Date.now()}`);
    const policy = {
        specMode: "page-object",
        requirePageObjects: false,
        allowInlineFallback: true,
        allowInlineDebugMode: true,
        allowCandidateGeneration: false,
        blockPromotionWhenPageObjectMissing: false
    };
    const appProfile = (0, app_profile_1.deriveAppProfile)({ appProfile: "strategy-inline-test", baseUrl: env_1.config.app.baseUrl });
    const entry = await (0, promote_plan_1.promoteExecutionPlan)({
        plan: basePlan("inline strategy fallback"),
        overwrite: true,
        outputRoot: root,
        promotionPolicy: policy,
        fullConfig: env_1.config,
        appProfileObject: appProfile
    });
    const caseDir = node_path_1.default.dirname(entry.planPath);
    const diagnosticsPath = node_path_1.default.join(caseDir, "promotion-diagnostics.json");
    const raw = await promises_1.default.readFile(diagnosticsPath, "utf-8");
    const diagnostics = JSON.parse(raw);
    (0, test_1.expect)(diagnostics.requestedStrategy).toBe("pom");
    (0, test_1.expect)(diagnostics.selectedStrategy).toBe("inline");
    (0, test_1.expect)(diagnostics.fallbackUsed).toBe(true);
    (0, test_1.expect)(String(diagnostics.reason)).toContain("pom_unavailable");
});
(0, test_1.test)("require pom runtime falla cuando no disponible", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", `promo-require-pom-${Date.now()}`);
    const policy = {
        specMode: "page-object",
        requirePageObjects: false,
        allowInlineFallback: true,
        allowInlineDebugMode: true,
        allowCandidateGeneration: false,
        blockPromotionWhenPageObjectMissing: false
    };
    const appProfile = (0, app_profile_1.deriveAppProfile)({ appProfile: "strategy-require-pom-test", baseUrl: env_1.config.app.baseUrl });
    await (0, test_1.expect)((0, promote_plan_1.promoteExecutionPlan)({
        plan: basePlan("require pom runtime"),
        overwrite: true,
        outputRoot: root,
        promotionPolicy: policy,
        fullConfig: env_1.config,
        appProfileObject: appProfile,
        requirePomRuntime: true
    })).rejects.toThrow(/POM_RUNTIME_REQUIRED_BUT_UNAVAILABLE/);
});
(0, test_1.test)("spec marker pom e inline", async () => {
    const root = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", `promo-marker-${Date.now()}`);
    const inlinePolicy = {
        specMode: "inline-debug",
        requirePageObjects: false,
        allowInlineFallback: true,
        allowInlineDebugMode: true,
        allowCandidateGeneration: false,
        blockPromotionWhenPageObjectMissing: false
    };
    const appInline = (0, app_profile_1.deriveAppProfile)({ appProfile: "strategy-marker-inline", baseUrl: env_1.config.app.baseUrl });
    const inlineEntry = await (0, promote_plan_1.promoteExecutionPlan)({
        plan: basePlan("inline marker"),
        overwrite: true,
        outputRoot: root,
        promotionPolicy: inlinePolicy,
        fullConfig: env_1.config,
        appProfileObject: appInline,
        inlineDebugMode: true
    });
    const inlineSpec = await promises_1.default.readFile(inlineEntry.specPath, "utf-8");
    (0, test_1.expect)(inlineSpec).toContain(`PROMOTED_SPEC_STRATEGY = "inline_executor"`);
});
