import path from "node:path";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { AppAutomationPaths, AppProfile } from "./app-profile";
import type { PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import type { PageObjectRegistry } from "../types/page-object.types";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";
import { ensurePageObjectRegistry } from "./page-object-registry";
import { generatePOMSpecFromPlan } from "./spec-generator-pom";

function escapeSpecString(value: string): string {
  return value.replace(/'/g, "''");
}

function buildPortablePathFromCwd(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

function buildPortablePathFromSpec(specPath: string, absoluteTargetPath: string): string {
  return path.relative(path.dirname(specPath), absoluteTargetPath).replace(/\\/g, "/");
}

export type GenerateSpecOptions = {
  plan: ExecutionPlan;
  automationId: string;
  appProfile: AppProfile;
  appPaths: AppAutomationPaths;
  promotionPolicy?: PromotionPolicy;
  inlineDebugMode?: boolean;
  pageObjectRegistry?: PageObjectRegistry;
  authFlowOptions?: { alias?: string; landing?: string; testDataJson?: string; insertionAfterStepIndex?: number };
};

export type GenerateSpecResult = {
  specContent: string;
  selectedStrategy: "pom" | "inline";
  fallbackUsed: boolean;
  fallbackReason?: string;
  pomStatus?: POMPromotionStatus;
  usedPageObjects: string[];
  missingPageObjects: string[];
  missingMethods: string[];
  generatedCandidates: number;
  usedAuthFlow?: boolean;
  validationErrors: string[];
  inlineFallbackUsed?: boolean;
  requiredDataUsed?: string[];
};

export function generateSpecFromPlan(
  plan: ExecutionPlan,
  automationId: string,
  appProfile: AppProfile,
  appPaths: AppAutomationPaths
): string {
  return _generateInlineSpec(plan, automationId, appProfile, appPaths);
}

export async function generateSpecFromPlanWithPolicy(
  options: GenerateSpecOptions
): Promise<GenerateSpecResult> {
  const policy = options.promotionPolicy ?? DEFAULT_PROMOTION_POLICY;
  const inlineDebug = options.inlineDebugMode ?? false;

  // If inline debug is explicitly requested, generate inline spec marked as debug
  if (inlineDebug || policy.specMode === "inline-debug") {
    const content = _generateInlineSpec(
      options.plan,
      options.automationId,
      options.appProfile,
      options.appPaths
    );
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
      registry = await ensurePageObjectRegistry(options.appProfile);
    } catch {
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
  const pomResult = generatePOMSpecFromPlan(
    options.plan,
    options.automationId,
    options.appProfile,
    options.appPaths,
    registry,
    policy,
    inlineDebug,
    options.authFlowOptions
  );

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
    const content = _generateInlineSpec(
      options.plan,
      options.automationId,
      options.appProfile,
      options.appPaths
    );
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

function _generateInlineSpec(
  plan: ExecutionPlan,
  automationId: string,
  appProfile: AppProfile,
  appPaths: AppAutomationPaths
): string {
  const escapedTitle = escapeSpecString(plan.scenario.title);
  const escapedProfile = escapeSpecString(appProfile.appSlug);
  const escapedPlanPath = escapeSpecString(buildPortablePathFromCwd(appPaths.planPath ?? ""));
  const escapedConfigPath = escapeSpecString(buildPortablePathFromCwd(appPaths.configPath));
  const specPath = appPaths.specPath ?? "";
  const envImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, path.resolve(process.cwd(), "src/config/env.ts")));
  const dataImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, path.resolve(process.cwd(), "src/data/index.ts")));
  const executorImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, path.resolve(process.cwd(), "src/runner/execution-plan-executor.ts")));
  const appProfileImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, path.resolve(process.cwd(), "src/automations/app-profile.ts")));
  const execPlanTypeImportPath = escapeSpecString(buildPortablePathFromSpec(specPath, path.resolve(process.cwd(), "src/types/execution-plan.types.ts")));
  const escapedEvidenceDir = escapeSpecString(buildPortablePathFromCwd(appPaths.caseRunsDir ?? appPaths.runsDir));

  return [
    "import { test } from '@playwright/test';",
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
