"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSpecFromPlan = generateSpecFromPlan;
exports.generateSpecFromPlanWithPolicy = generateSpecFromPlanWithPolicy;
const node_path_1 = __importDefault(require("node:path"));
const automation_promotion_types_1 = require("../types/automation-promotion.types");
const page_object_registry_1 = require("./page-object-registry");
const spec_generator_pom_1 = require("./spec-generator-pom");
function escapeSpecString(value) {
    return value.replace(/'/g, "''");
}
function buildPortablePathFromCwd(absolutePath) {
    return node_path_1.default.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}
function buildPortablePathFromSpec(specPath, absoluteTargetPath) {
    return node_path_1.default.relative(node_path_1.default.dirname(specPath), absoluteTargetPath).replace(/\\/g, "/");
}
function generateSpecFromPlan(plan, automationId, appProfile, appPaths, metadata) {
    return _generateInlineSpec(plan, automationId, appProfile, appPaths, metadata);
}
async function generateSpecFromPlanWithPolicy(options) {
    const policy = options.promotionPolicy ?? automation_promotion_types_1.DEFAULT_PROMOTION_POLICY;
    const inlineDebug = options.inlineDebugMode ?? false;
    // If inline debug is explicitly requested, generate inline spec marked as debug
    if (inlineDebug || policy.specMode === "inline-debug") {
        const content = _generateInlineSpec(options.plan, options.automationId, options.appProfile, options.appPaths, { sectionSlug: options.sectionSlug, scenarioId: options.scenarioId });
        return {
            specContent: content,
            selectedStrategy: "inline",
            fallbackUsed: false,
            pomStatus: "inline_debug_only",
            usedPageObjects: [],
            missingPageObjects: [],
            missingMethods: [],
            generatedCandidates: 0,
            usedAuthFlow: false,
            validationErrors: []
        };
    }
    // Load/ensure page object registry
    let registry = options.pageObjectRegistry;
    if (!registry) {
        try {
            registry = await (0, page_object_registry_1.ensurePageObjectRegistry)(options.appProfile);
        }
        catch {
            registry = {
                version: "1.0",
                appSlug: options.appProfile.appSlug,
                pageObjects: [],
                componentCandidates: [],
                updatedAt: new Date().toISOString()
            };
        }
    }
    // Generate POM spec
    const pomResult = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(options.plan, options.automationId, options.appProfile, options.appPaths, registry, policy, inlineDebug, options.authFlowOptions, { sectionSlug: options.sectionSlug, scenarioId: options.scenarioId });
    // If POM spec is sufficient, return it
    if (pomResult.pomStatus === "promoted" || pomResult.pomStatus === "page_object_candidate_created") {
        return {
            specContent: pomResult.specContent,
            selectedStrategy: "pom",
            fallbackUsed: false,
            pomStatus: pomResult.pomStatus,
            usedPageObjects: pomResult.usedPageObjects,
            missingPageObjects: pomResult.missingPageObjects,
            missingMethods: pomResult.missingMethods,
            generatedCandidates: pomResult.generatedCandidates,
            usedAuthFlow: pomResult.usedAuthFlow,
            validationErrors: pomResult.validationErrors,
            inlineFallbackUsed: pomResult.inlineFallbackUsed,
            requiredDataUsed: pomResult.requiredDataUsed
        };
    }
    // If POM is insufficient and we have missing methods/objects
    if (policy.requirePageObjects && !policy.allowInlineFallback) {
        return {
            specContent: pomResult.specContent,
            selectedStrategy: "pom",
            fallbackUsed: false,
            pomStatus: pomResult.pomStatus,
            usedPageObjects: pomResult.usedPageObjects,
            missingPageObjects: pomResult.missingPageObjects,
            missingMethods: pomResult.missingMethods,
            generatedCandidates: pomResult.generatedCandidates,
            usedAuthFlow: pomResult.usedAuthFlow,
            validationErrors: pomResult.validationErrors,
            inlineFallbackUsed: pomResult.inlineFallbackUsed,
            requiredDataUsed: pomResult.requiredDataUsed
        };
    }
    // Fallback to inline if allowed
    if (policy.allowInlineFallback) {
        const content = _generateInlineSpec(options.plan, options.automationId, options.appProfile, options.appPaths, { sectionSlug: options.sectionSlug, scenarioId: options.scenarioId });
        return {
            specContent: content,
            selectedStrategy: "inline",
            fallbackUsed: true,
            fallbackReason: `pom_unavailable:${pomResult.pomStatus ?? "unknown"}`,
            pomStatus: undefined,
            usedPageObjects: [],
            missingPageObjects: [],
            missingMethods: [],
            generatedCandidates: 0,
            usedAuthFlow: false,
            validationErrors: []
        };
    }
    return {
        specContent: pomResult.specContent,
        selectedStrategy: "pom",
        fallbackUsed: false,
        pomStatus: pomResult.pomStatus,
        usedPageObjects: pomResult.usedPageObjects,
        missingPageObjects: pomResult.missingPageObjects,
        missingMethods: pomResult.missingMethods,
        generatedCandidates: pomResult.generatedCandidates,
        usedAuthFlow: pomResult.usedAuthFlow,
        validationErrors: pomResult.validationErrors,
        inlineFallbackUsed: pomResult.inlineFallbackUsed,
        requiredDataUsed: pomResult.requiredDataUsed
    };
}
function _generateInlineSpec(plan, automationId, appProfile, appPaths, metadata) {
    const escapedTitle = escapeSpecString(plan.scenario.title);
    const escapedProfile = escapeSpecString(appProfile.appSlug);
    const escapedPlanPath = escapeSpecString(buildPortablePathFromCwd(appPaths.planPath ?? ""));
    const escapedConfigPath = escapeSpecString(buildPortablePathFromCwd(appPaths.configPath));
    const specPath = appPaths.specPath ?? "";
    const envImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, node_path_1.default.resolve(process.cwd(), "src/config/env.ts")));
    const dataImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, node_path_1.default.resolve(process.cwd(), "src/data/index.ts")));
    const executorImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, node_path_1.default.resolve(process.cwd(), "src/runner/execution-plan-executor.ts")));
    const appProfileImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, node_path_1.default.resolve(process.cwd(), "src/automations/app-profile.ts")));
    const execPlanTypeImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, node_path_1.default.resolve(process.cwd(), "src/types/execution-plan.types.ts")));
    const escapedEvidenceDir = escapeSpecString(buildPortablePathFromCwd(appPaths.caseRunsDir ?? appPaths.runsDir));
    const sectionSlug = metadata?.sectionSlug ?? "default-section";
    const scenarioId = metadata?.scenarioId ?? plan.scenario.externalId ?? `C${plan.scenario.caseId ?? ""}`;
    return [
        "import { test, expect } from '@playwright/test';",
        "import { readFileSync } from 'node:fs';",
        "import { resolve } from 'node:path';",
        `import { config } from '${envImportPath.replace(/\.ts$/, "")}';`,
        `import { buildDataContext } from '${dataImportPath.replace(/\/index\.ts$/, "").replace(/\.ts$/, "")}';`,
        `import { executeExecutionPlan } from '${executorImportPath.replace(/\.ts$/, "")}';`,
        `import { loadPromotedAppConfigSync, buildMergedConfig } from '${appProfileImportPath.replace(/\.ts$/, "")}';`,
        `import type { ExecutionPlan } from '${execPlanTypeImportPath.replace(/\.ts$/, "")}';`,
        "",
        `export const PROMOTED_SPEC_STRATEGY = "inline_executor";`,
        "",
        `const SPEC_APP_PROFILE = '${escapedProfile}';`,
        `const SPEC_APP_CONFIG_PATH = '${escapedConfigPath}';`,
        `const SPEC_PLAN_PATH = '${escapedPlanPath}';`,
        "",
        "const __appConfig = loadPromotedAppConfigSync({",
        "  appSlug: SPEC_APP_PROFILE,",
        "  configPath: resolve(process.cwd(), SPEC_APP_CONFIG_PATH)",
        "});",
        "const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;",
        "",
        "const planPath = resolve(process.cwd(), SPEC_PLAN_PATH);",
        "const plan = JSON.parse(readFileSync(planPath, 'utf8')) as ExecutionPlan;",
        "",
        `test('${escapedTitle}', async ({ page }) => {`,
        `  process.env.APP_SLUG = '${escapeSpecString(appProfile.appSlug)}';`,
        `  process.env.SECTION_SLUG = '${escapeSpecString(sectionSlug)}';`,
        `  process.env.SCENARIO_ID = '${escapeSpecString(scenarioId)}';`,
        `  process.env.SCENARIO_TITLE = '${escapedTitle}';`,
        "",
        "  const dataContext = buildDataContext(__runtimeConfig);",
        "  await executeExecutionPlan({",
        "    page,",
        "    plan,",
        "    dataContext,",
        "    appBaseUrl: __runtimeConfig.app.baseUrl,",
        "    runtimeConfig: __runtimeConfig,",
        `    evidenceDir: resolve(process.cwd(), '${escapedEvidenceDir}')`,
        "  });",
        "});"
    ].join("\n");
}
