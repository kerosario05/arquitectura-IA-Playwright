import { config, requireJiraConfig } from "../config/env";
import type { LoginMode } from "../types/env.types";
import { JiraClient } from "../clients/jira.client";
import { loadJiraIssues } from "./jira-scenario-source";
import { generateScenariosWithAi } from "./codex-scenario-generator";
import { validateScenario } from "./scenario-validator";
import {
  resolveAppForPreview,
  ensureFunctionalAppProfile,
  loadAppConfig,
  getRouteProfileFromConfig,
  buildEntrySteps,
  detectKioskoInfoProductos,
  seedKioskoInfoProductosRouteProfile,
} from "../automations/app-auto-resolver";
import { buildDerivedExecutionContext } from "./route-profile-derived-context";
import { repairMissingIntermediates, logIntermediateRepair } from "./scenario-intermediate-repair";
import { loadOrCreateKnowledgeContext, buildKnowledgeContextForScenarioGeneration, type KnowledgeContext } from "./knowledge-context-resolver";
import { detectHuIntent, isCatalogListingIntent, isTransactionalDocumentIntent, type HuIntentDetection } from "./hu-intent-classifier";
import type {
  ScenarioPreviewRequest,
  ScenarioPreviewResponse,
  ScenarioPreviewError,
  ValidatedScenario,
  McpRejectedScenario,
  McpScenario,
  McpRouteProfile,
} from "./scenario-types";

function resolveAppSlug(requestAppSlug?: string): string {
  if (requestAppSlug?.trim()) return requestAppSlug.trim();
  const envSlug = process.env.APP_SLUG?.trim();
  if (envSlug) return envSlug;
  return "arquitectura-automatizacion";
}

function normalizeScenariosToTargetApp(scenarios: McpScenario[], targetAppSlug: string): McpScenario[] {
  if (!targetAppSlug) return scenarios;
  return scenarios.map((sc) => ({
    ...sc,
    appSlug: targetAppSlug,
    targetAppSlug,
  }));
}

function formatEntryStep(label: string, index: number): string {
  return `${index + 1}. Clic en "${label}".`;
}

function stepsMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/^\d+[\.)]\s*/, "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return norm(a) === norm(b);
}

function stepIsClickOnLabel(step: string, label: string): boolean {
  const normalized = step.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.includes(`clic en "${label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}"`);
}

function isEntryClickStep(step: string, entryLabels: string[]): boolean {
  const stripped = step.replace(/^\d+[\.)]\s*/, "").trim();
  if (!/^clic en "/i.test(stripped)) return false;
  return entryLabels.some((label) => stepIsClickOnLabel(step, label));
}

export function insertEntrySteps(
  scenario: McpScenario,
  entrySteps: string[],
  entryStepConfigs?: EntryStepConfig[],
): McpScenario {
  const labels: string[] = [];

  // Prefer new entrySteps format (action/target) over old entry labels
  if (entryStepConfigs && entryStepConfigs.length > 0) {
    for (const es of entryStepConfigs) {
      if (es.action === "click" && es.target) labels.push(es.target);
    }
  }

  // Fallback to old format (string labels from entry visibleLabels)
  if (labels.length === 0) labels.push(...entrySteps);

  if (!labels.length || !scenario.steps || scenario.steps.length === 0) return scenario;

  const formattedEntry = labels.map((label, i) => formatEntryStep(label, i));
  const existingSteps = scenario.steps.map((s) => s.trim());

  // Remove ALL existing entry click steps (damaged or canonical) from anywhere in the list
  const nonEntrySteps = existingSteps.filter((step) => !isEntryClickStep(step, labels));

  // Prepend canonical entry steps
  const newSteps = [...formattedEntry, ...nonEntrySteps];

  // Re-number all steps
  const renumbered = newSteps.map((step, idx) => {
    return step.replace(/^\d+[\.)]\s*/, `${idx + 1}. `);
  });

  return {
    ...scenario,
    steps: renumbered,
  };
}

function loadAppConfigSync(appSlug: string): Record<string, unknown> | null {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const appsDir = path.join(process.cwd(), "automations", "apps");
    const appConfigPath = path.join(appsDir, appSlug, "app.config.json");
    if (!fs.existsSync(appConfigPath)) return null;
    const content = fs.readFileSync(appConfigPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

type EntryStepConfig = {
  action: string;
  target: string;
  when?: string;
  reason?: string;
};

function buildRouteProfileForPrompt(
  targetAppSlug: string,
  requestRouteProfile?: McpRouteProfile,
  jiraSummary?: string,
  jiraDescription?: string,
  testrailSectionName?: string,
  scenarioTitles?: string[],
): { routeProfile: McpRouteProfile | null; source: string; entrySteps: EntryStepConfig[]; loginMode?: string } {
  console.log(`[route-profile] resolving routeProfile targetAppSlug=${targetAppSlug} requestRouteProfile=${requestRouteProfile?.name ?? "none"}`);

  // 1. Explicit routeProfile from request
  if (requestRouteProfile && requestRouteProfile.name) {
    const rp = requestRouteProfile as Record<string, unknown>;
    const es = Array.isArray(rp.entrySteps) ? rp.entrySteps as EntryStepConfig[] : [];
    console.log(`[route-profile] source=request name=${requestRouteProfile.name} entry=${requestRouteProfile.entry?.length ?? 0} entrySteps=${es.length} domainTerms=${Object.keys(requestRouteProfile.domainTerms ?? {}).length} visibleControls=${requestRouteProfile.visibleControls?.length ?? 0}`);
    return { routeProfile: requestRouteProfile, source: "request", entrySteps: es };
  }

  // 2. Load from app.config.json
  const appConfig = loadAppConfigSync(targetAppSlug);
  console.log(`[route-profile] appConfig loaded=${appConfig !== null} hasRouteProfile=${appConfig?.routeProfile !== undefined}`);
  const configRp = getRouteProfileFromConfig(appConfig);
  if (configRp) {
    const entry = configRp.entry as unknown[] | undefined;
    const aliases = configRp.aliases as Record<string, unknown> | undefined;
    const domainTerms = configRp.domainTerms as Record<string, unknown> | undefined;
    const visibleControls = configRp.visibleControls as unknown[] | undefined;
    const entrySteps = configRp.entrySteps as unknown[] | undefined;

    console.log(`[route-profile] configRp found name=${configRp.name} entry=${entry?.length ?? 0} aliases=${Object.keys(aliases ?? {}).length} domainTerms=${Object.keys(domainTerms ?? {}).length} visibleControls=${visibleControls?.length ?? 0} entrySteps=${entrySteps?.length ?? 0}`);

    if ((entry && entry.length > 0) || (aliases && Object.keys(aliases).length > 0)) {
      const es = Array.isArray(configRp.entrySteps) ? configRp.entrySteps as EntryStepConfig[] : [];
      console.log(`[route-profile] source=app_config returning routeProfile name=${configRp.name}`);
      return {
        routeProfile: configRp as unknown as McpRouteProfile,
        source: "app_config",
        entrySteps: es,
        loginMode: appConfig?.loginMode as string | undefined,
      };
    } else {
      console.log(`[route-profile] configRp found but entry/aliases validation failed - entry.length=${entry?.length ?? 0} aliases.keys=${Object.keys(aliases ?? {}).length}`);
    }
  } else {
    console.log(`[route-profile] configRp=null after getRouteProfileFromConfig`);
  }

  // 3. Seed for KIOSKO / Información de productos
  if (
    detectKioskoInfoProductos({
      targetAppSlug,
      jiraSummary,
      jiraDescription,
      testrailSectionName,
      scenarioTitles,
    })
  ) {
    const seed = seedKioskoInfoProductosRouteProfile() as unknown as McpRouteProfile;
    console.log(`[route-profile] source=seed_kiosko_info_productos name=${seed.name}`);
    return {
      routeProfile: seed,
      source: "seed_kiosko_info_productos",
      entrySteps: [],
      loginMode: appConfig?.loginMode as string | undefined,
    };
  }

  // 4. Default empty
  console.log(`[route-profile] source=default returning null routeProfile`);
  return { routeProfile: null, source: "default", entrySteps: [], loginMode: appConfig?.loginMode as string | undefined };
}

export async function generateScenarioPreview(
  req: ScenarioPreviewRequest,
): Promise<ScenarioPreviewResponse | ScenarioPreviewError> {
  if (!req.projectKey) {
    return { ok: false, error: "invalid_request", message: "projectKey is required" };
  }
  if (!req.activeSprint && !req.sprintId) {
    return { ok: false, error: "invalid_request", message: "activeSprint: true or sprintId is required" };
  }

  // Resolve effective appSlug using fallback chain (request → APP_SLUG env → hardcoded default)
  const effectiveAppSlug = resolveAppSlug(req.appSlug);

  // Ensure app.knowledge.json exists (create empty if not)
  loadOrCreateKnowledgeContext(effectiveAppSlug);

  // Pass the resolved appSlug to the app resolver for priority resolution
  const appInference = resolveAppForPreview({
    targetAppSlug: req.targetAppSlug,
    targetAppName: req.targetAppName,
    testrailSectionName: req.testrailSectionName,
    requestAppSlug: effectiveAppSlug,
  });

  console.log(
    `[app-resolution] requestAppSlug=${effectiveAppSlug} requestTargetAppSlug=${req.targetAppSlug ?? "none"} inferenceSource=${appInference.source} inferredAppSlug=${appInference.appSlug} effectiveTargetAppSlug=${appInference.appSlug}`,
  );
  console.log(
    `[scenarios:preview] projectKey=${req.projectKey} sprintId=${req.sprintId ?? "active"} status=${req.status ?? "any"} appSlug=${effectiveAppSlug} targetAppSlug=${appInference.appSlug} inferenceSource=${appInference.source}`,
  );
  console.log(
    `[scenarios:preview] targetAppSlug=${appInference.appSlug} targetAppName=${appInference.appName}`,
  );
  console.log(
    `[scenarios:preview] appInference=${JSON.stringify(appInference)}`,
  );

  // Ensure functional app profile exists
  let appProfileResult;
  try {
    appProfileResult = await ensureFunctionalAppProfile({
      appSlug: appInference.appSlug,
      appName: appInference.appName,
      source: appInference.source,
      sectionName: req.testrailSectionName,
    });
  } catch (err) {
    console.error(`[scenarios:preview] ensureFunctionalAppProfile failed: ${err}`);
    appProfileResult = {
      appSlug: appInference.appSlug,
      appName: appInference.appName,
      appDir: "",
      appConfigPath: "",
      created: false,
      configCreated: false,
    };
  }

  const jiraConfig = requireJiraConfig(config);
  const jira = new JiraClient(jiraConfig);

  let sprintId: number;
  let sprintName: string;

  if (req.activeSprint) {
    const active = await jira.getActiveSprint(req.projectKey);
    if (!active) {
      return {
        ok: false,
        error: "no_active_sprint",
        message: `No hay sprint activo para el proyecto ${req.projectKey}`,
      };
    }
    sprintId = active.id;
    sprintName = active.name;
  } else {
    sprintId = req.sprintId!;
    sprintName = `Sprint ${sprintId}`;
  }

  const issues = await loadJiraIssues(
    jiraConfig,
    req.projectKey,
    sprintId,
    req.status,
    req.maxResults ?? 50,
  );

  console.log(`[scenarios:preview] loaded ${issues.length} jira issues`);

  // Filter by selectedIssueKeys if provided (from QA Lab UI selection)
  if (req.selectedIssueKeys && req.selectedIssueKeys.length > 0) {
    const selectedKeys = new Set(req.selectedIssueKeys);
    const filtered = issues.filter((i) => selectedKeys.has(i.key));
    console.log(`[scenario-preview] jira selectedIssueKeys=${JSON.stringify(req.selectedIssueKeys)} filtered=${filtered.length}/${issues.length}`);
    if (filtered.length === 0) {
      return { ok: false, error: "jira_issues_not_selected", message: "Ninguna de las historias seleccionadas coincide con los filtros aplicados." };
    }
    issues.length = 0;
    issues.push(...filtered);
  } else {
    console.log(`[scenario-preview] jira selectedIssueKeys=none`);
  }

  console.log(`[jira] selected issues count=${issues.length} keys=${JSON.stringify(issues.map((i) => i.key))}`);
  // Detect primary HU intent for guard logic
  const primaryIssueIntent: HuIntentDetection = issues.length > 0
    ? detectHuIntent(
        { summary: issues[0].summary, description: issues[0].description, acceptanceCriteria: issues[0].acceptanceCriteria },
        issues[0].key
      )
    : { intent: "unknown_flow", confidence: "low", reason: "no_issue", matchedSignals: [] };
  if (issues.length > 0) {
    console.log(`[scenario-preview] primaryHuIntent issue=${issues[0].key} intent=${primaryIssueIntent.intent}`);
  }


  const maxIssues = Number(process.env.SCENARIO_PREVIEW_MAX_ISSUES) || 5;
  if (issues.length > maxIssues) {
    console.log(`[scenarios:preview] limiting issues from ${issues.length} to ${maxIssues}`);
    issues.length = maxIssues;
  }

  // Gather jira context for routeProfile seeding
  const jiraSummary = issues.length > 0 ? issues[0].summary : undefined;
  const jiraDescription = issues.length > 0 ? issues[0].description : undefined;

  // Build initial routeProfile (before AI generation)
  const { routeProfile: initialRouteProfile, source: rpSource, entrySteps: initialEntrySteps, loginMode } = buildRouteProfileForPrompt(
    appInference.appSlug,
    undefined,
    jiraSummary,
    jiraDescription,
    req.testrailSectionName,
  );

  console.log(`[scenarios:preview] routeProfile source=${rpSource}`);
  console.log(`[scenarios:preview] routeProfileName=${initialRouteProfile?.name ?? "null"}`);
  console.log(`[scenarios:preview] routeProfileEntry=${JSON.stringify(initialRouteProfile?.entry ?? [])}`);

  // Ensure catalog context for scenario generation (enrichment phase)
  const shouldSkipCatalogContext = primaryIssueIntent.intent !== "catalog_listing_flow" && primaryIssueIntent.intent !== "product_detail_flow";
  let enrichedRouteProfile, catalogDiagnostics;
  let catalogOptions;

  if (!shouldSkipCatalogContext) {
    const { ensureScenarioGenerationContext } = await import("./scenario-catalog-context");
    catalogOptions = req.catalogOptions ?? {
      useDiscoveredCatalog: process.env.AI_CATALOG_AUTO_DISCOVER === "true",
      catalogMode: process.env.AI_CATALOG_MODE === "refresh" ? "refresh" : "existing",
      coverageMode: process.env.AI_CATALOG_COVERAGE_MODE as "representative" | "exhaustive" || "representative",
      maxProductsPerCategory: parseInt(process.env.AI_CATALOG_MAX_PER_CATEGORY || "2", 10),
    };
    const result = await ensureScenarioGenerationContext(
      appInference.appSlug,
      initialRouteProfile,
      catalogOptions,
      (loginMode || "no_login") as LoginMode,
      config
    );
    enrichedRouteProfile = result.routeProfile;
    catalogDiagnostics = result.diagnostics;
  } else {
    console.log(`[catalog-context] skipped reason=preview_non_catalog_intent huIntent=${primaryIssueIntent.intent}`);
    catalogOptions = {
      useDiscoveredCatalog: false,
      catalogMode: "existing",
      coverageMode: "representative",
      maxProductsPerCategory: 2,
    };
  }

  // Use enriched routeProfile for scenario generation
  const routeProfileForGeneration = enrichedRouteProfile ?? initialRouteProfile;

  if (issues.length === 0) {
    return {
      ok: true,
      source: {
        mode: req.sourceMode ?? "jira",
        projectKey: req.projectKey,
        sprintId,
        status: req.status ?? null,
        issuesFound: 0,
      },
      testrail: {
        projectId: req.testrailProjectId ?? null,
        suiteId: req.testrailSuiteId ?? null,
        sectionId: req.testrailSectionId ?? null,
        sectionName: req.testrailSectionName ?? null,
      },
      appSlug: effectiveAppSlug,
      targetAppSlug: appInference.appSlug,
      targetAppName: appInference.appName,
      appInference,
      appProfilePath: appProfileResult.appConfigPath,
      summary: { generated: 0, valid: 0, invalid: 0, rejected: 0, blocked: 0, routePending: 0, automationReady: 0 },
      routeProfile: initialRouteProfile,
      scenarios: [],
      rejected: [],
      blockedScenarios: [],
      warnings: [`No Jira issues found for project ${req.projectKey}, sprint ${sprintName}`],
    };
  }

  const testrailMeta =
    req.testrailProjectId && req.testrailSuiteId
      ? {
          projectId: req.testrailProjectId,
          suiteId: req.testrailSuiteId,
          sectionId: req.testrailSectionId,
          sectionName: req.testrailSectionName,
        }
      : undefined;

  let generationResult;
  let huModel: any = null;
  let scenarioPlan: any = null;

  // Pre-compute HU model and scenario plan for AI prompt context
  if (issues.length > 0) {
    const huTextForAi = [issues[0].summary, issues[0].description, issues[0].acceptanceCriteria || ""].filter(Boolean).join(" ");
    if (huTextForAi) {
      huModel = extractHuScenarioModel(huTextForAi);
      scenarioPlan = buildRoutePendingScenarioPlan(huModel);
      console.log(`[scenario-preview] aiPrompt huModel=enabled huPlan=enabled`);
      console.log(`[scenario-preview] aiPrompt plan complexity=${scenarioPlan.complexity} target=${scenarioPlan.scenarioCountTarget} variants=${scenarioPlan.variants.length}`);
    }
  }

  try {
    generationResult = await generateScenariosWithAi(
      issues,
      effectiveAppSlug,
      testrailMeta,
      appInference.appSlug,
      appInference.appName,
      routeProfileForGeneration,
      initialEntrySteps,
      loginMode,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      huModel,
      scenarioPlan,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scenarios:preview] failed error=${message}`);

    const [code, ...rest] = message.split("|");
    const detail = rest.join("|") || message;

    const errorMap: Record<string, { error: string; status: number }> = {
      AI_PROVIDER_UNAVAILABLE: { error: "ai_provider_unavailable", status: 503 },
      AI_GENERATION_TIMEOUT: { error: "ai_generation_timeout", status: 504 },
      AI_GENERATION_FAILED: { error: "ai_generation_failed", status: 502 },
      EMPTY_AI_RESPONSE: { error: "empty_ai_response", status: 502 },
      INVALID_AI_RESPONSE: { error: "invalid_ai_response", status: 502 },
      SKILL_NOT_FOUND: { error: "skill_not_found", status: 500 },
      AI_RETURNED_CSV: { error: "ai_returned_csv_instead_of_json", status: 502 },
    };

    const mapped = errorMap[code] || { error: "scenario_generation_failed", status: 502 };

    return {
      ok: false,
      error: mapped.error,
      message: detail,
    } as ScenarioPreviewError;
  }

  // Normalize scenarios to targetAppSlug
  let rawScenarios = generationResult.scenarios ?? [];
  if (appInference.appSlug && appInference.appSlug !== effectiveAppSlug) {
    rawScenarios = normalizeScenariosToTargetApp(rawScenarios, appInference.appSlug);
  }

  // Post-Codex: re-detect routeProfile from generated scenario titles
  // This catches cases where Jira summary didn't contain the module name but scenarios do
  const scenarioTitles = rawScenarios.map((s) => s.title);
  const postCodexDetection = detectKioskoInfoProductos({
    targetAppSlug: appInference.appSlug,
    jiraSummary,
    jiraDescription,
    testrailSectionName: req.testrailSectionName,
    scenarioTitles,
  });

  let resolvedRouteProfile = initialRouteProfile;
  if (postCodexDetection && (!initialRouteProfile || !initialRouteProfile.name)) {
    console.log(`[scenarios:preview] post-codex detection: KIOSKO/InfoProductos detected from scenario titles`);
    resolvedRouteProfile = seedKioskoInfoProductosRouteProfile() as unknown as McpRouteProfile;
  }

  // Log entry steps — prefer new format, fallback to old
  const oldEntrySteps = buildEntrySteps(resolvedRouteProfile as unknown as Record<string, unknown>);
  const configRp = resolvedRouteProfile ? (resolvedRouteProfile as Record<string, unknown>).entrySteps : undefined;
  const newEntrySteps = Array.isArray(configRp) && configRp.length > 0 ? configRp as EntryStepConfig[] : [];
  console.log(`[scenarios:preview] oldEntrySteps=${JSON.stringify(oldEntrySteps)} newEntrySteps=${JSON.stringify(newEntrySteps)}`);

  // Log before normalize
  for (const sc of rawScenarios) {
    const firstSteps = (sc.steps ?? []).slice(0, 3);
    console.log(
      `[scenarios:preview] beforeNormalize scenarioTitle="${sc.title}" firstSteps=${JSON.stringify(firstSteps)}`,
    );
  }

  // Insert entry steps if routeProfile has entry — prefer new format
  if (newEntrySteps.length > 0 || oldEntrySteps.length > 0) {
    rawScenarios = rawScenarios.map((sc) => {
      const repaired = insertEntrySteps(sc, oldEntrySteps, newEntrySteps);
      if (repaired !== sc) {
        if (!generationResult.warnings) generationResult.warnings = [];
        const labels = newEntrySteps.length > 0
          ? newEntrySteps.filter((es) => es.action === "click").map((es) => es.target).join(" → ")
          : oldEntrySteps.join(" → ");
        generationResult.warnings.push(
          `Scenario "${sc.title}": entry_steps_inserted - Added missing entry steps: ${labels}`,
        );
      }
      return repaired;
    });
  }

  // Log after normalize
  for (const sc of rawScenarios) {
    const firstSteps = (sc.steps ?? []).slice(0, 3);
    console.log(
      `[scenarios:preview] afterNormalize scenarioTitle="${sc.title}" firstSteps=${JSON.stringify(firstSteps)}`,
    );
  }

  // Declare rejected and routeResolutions early
  const rejected: McpRejectedScenario[] = generationResult.rejected ?? [];
  const warnings: string[] = generationResult.warnings ?? [];
  const routeResolutions = generationResult.routeResolutions;

  // Repair missing intermediate steps
  if (resolvedRouteProfile) {
    const derivedContext = buildDerivedExecutionContext(
      appInference.appSlug,
      resolvedRouteProfile,
      routeResolutions ?? new Map(),
      newEntrySteps.length > 0
        ? newEntrySteps.filter((es) => es.action === "click").map((es) => es.target)
        : oldEntrySteps
    );

    console.log(
      `[scenarios:preview] intermediate-repair starting appSlug=${appInference.appSlug} ` +
        `scenariosCount=${rawScenarios.length} ` +
        `allowedClicks=${derivedContext.allowedExecutableClicks.length}`
    );

    rawScenarios = rawScenarios.map((sc) => {
      const resolution = routeResolutions?.get(sc.sourceIssueKey);
      const repairResult = repairMissingIntermediates(
        sc,
        resolvedRouteProfile,
        derivedContext,
        resolution,
        "medium" // Confidence threshold
      );

      logIntermediateRepair(sc.sourceIssueKey, sc.title, repairResult, appInference.appSlug);

      if (repairResult.repaired) {
        if (!generationResult.warnings) generationResult.warnings = [];
        generationResult.warnings.push(
          `Scenario "${sc.title}": intermediate_steps_inserted - Added ${repairResult.insertedCount} intermediate step(s)`
        );
        return {
          ...sc,
          steps: repairResult.repairedSteps,
        };
      } else if (repairResult.reasonCode !== "no_repair_needed") {
        // Repair failed - mark as rejected
        const errorDiag = repairResult.diagnostics.find((d) => d.level === "error");
        if (errorDiag) {
          rejected.push({
            sourceIssueKey: sc.sourceIssueKey,
            reason: `${repairResult.reasonCode}: ${errorDiag.message}`,
          });
          return null; // Will be filtered out
        }
      }

      return sc;
    }).filter((sc): sc is McpScenario => sc !== null);

    console.log(
      `[scenarios:preview] intermediate-repair complete ` +
        `remainingScenarios=${rawScenarios.length} ` +
        `rejected=${rejected.length}`
    );
  }

  // -- Quick catalog intent check --
  const isCatalogIntent = primaryIssueIntent.intent === "catalog_listing_flow" || primaryIssueIntent.intent === "product_detail_flow";

  // Generate deterministic seeds for coverage guarantee
  if (catalogOptions.useDiscoveredCatalog && routeProfileForGeneration && isCatalogIntent) {
    const { generateDeterministicSeeds } = await import("./scenario-deterministic-seeds");

    // Use first issue as context for HU scope filtering
    // Seeds will only be generated for products aligned with HU scope
    const issueContext = issues.length > 0 ? issues[0] : null;

    // Load appConfig to get valid automationType and setupStrategy for seeds
    const appConfig = loadAppConfigSync(appInference.appSlug);
    const seedAppConfig = {
      automationType: (appConfig?.automationType as string) || "ui_discovery",
      setupStrategy: (appConfig?.setupStrategy as string) || "no_login",
    };

    const seeds = generateDeterministicSeeds(
      routeProfileForGeneration,
      rawScenarios,
      issueContext,
      appInference.appSlug,
      catalogOptions.coverageMode ?? "representative",
      seedAppConfig
    );

    if (seeds.length > 0) {
      console.log(
        `[scenarios:preview] adding ${seeds.length} deterministic seeds for coverage guarantee ` +
          `(mode=${catalogOptions.coverageMode ?? "representative"})`
      );
      rawScenarios.push(...seeds);
    } else {
      console.log(
        `[scenarios:preview] no seeds needed - AI coverage complete for aligned categories/products ` +
          `(mode=${catalogOptions.coverageMode ?? "representative"})`
      );
    }
  }

  // Build blockedScenarios from routeResolutions
  const blockedScenarios: import("./scenario-types").BlockedScenario[] = [];

  if (routeResolutions) {
    for (const [issueKey, resolution] of routeResolutions.entries()) {
      if (!resolution.canGenerate) {
        const issue = issues.find(i => i.key === issueKey);
        const errorDiagnostic = resolution.diagnostics.find(d => d.level === "error");
        const reasonCode = (errorDiagnostic?.code ?? "unknown") as import("./scenario-types").DiagnosticCode;

        let suggestedAction = "review_route_profile";
        if (reasonCode === "needs_route_profile") {
          suggestedAction = "configure_route_profile";
        } else if (reasonCode === "missing_parent_route") {
          suggestedAction = "add_parent_route";
        } else if (reasonCode === "missing_intermediate_step") {
          suggestedAction = "add_intermediate_steps";
        }

        blockedScenarios.push({
          sourceIssueKey: issueKey,
          title: issue?.summary ?? `Issue ${issueKey}`,
          status: "blocked",
          reasonCode,
          reason: resolution.missingRouteReason ?? "Route not backed",
          diagnostics: resolution.diagnostics,
          appSlug: appInference.appSlug,
          appProfilePath: appProfileResult.appConfigPath,
          suggestedAction
        });
      }
    }
  }

  console.log(`[scenarios:preview] blockedScenarios=${blockedScenarios.length} from routeResolutions`);

  // Fallback: build blockedScenarios from rejected if routeResolutions didn't provide them
  const blockedFromRejected = new Set(blockedScenarios.map(b => b.sourceIssueKey));
  let fallbackCount = 0;

  for (const rej of rejected) {
    // Skip if already in blockedScenarios
    if (blockedFromRejected.has(rej.sourceIssueKey)) continue;

    // Detect route-first reasons
    const reasonLower = rej.reason.toLowerCase();
    let reasonCode: import("./scenario-types").DiagnosticCode | null = null;

    if (reasonLower.includes("needs_route_profile")) {
      reasonCode = "needs_route_profile";
    } else if (reasonLower.includes("missing_parent_route")) {
      reasonCode = "missing_parent_route";
    } else if (reasonLower.includes("missing_intermediate_step")) {
      reasonCode = "missing_intermediate_step";
    } else if (reasonLower.includes("missing_detail_selection_step")) {
      reasonCode = "missing_detail_selection_step";
    } else if (reasonLower.includes("ambiguous_route_target")) {
      reasonCode = "ambiguous_route_target";
    } else if (reasonLower.includes("unsupported_route_target")) {
      reasonCode = "unsupported_route_target";
    }

    // If route-first reason detected, create BlockedScenario
    if (reasonCode) {
      const issue = issues.find(i => i.key === rej.sourceIssueKey);
      const isError = reasonCode === "needs_route_profile" || reasonCode === "missing_parent_route";

      let suggestedAction = "review_route_profile";
      if (reasonCode === "needs_route_profile") {
        suggestedAction = "configure_route_profile";
      } else if (reasonCode === "missing_parent_route") {
        suggestedAction = "add_parent_route";
      } else if (reasonCode === "missing_intermediate_step") {
        suggestedAction = "add_intermediate_steps";
      }

      blockedScenarios.push({
        sourceIssueKey: rej.sourceIssueKey,
        title: issue?.summary ?? `Issue ${rej.sourceIssueKey}`,
        status: "blocked",
        reasonCode,
        reason: rej.reason,
        diagnostics: [
          {
            level: isError ? "error" : "warning",
            code: reasonCode,
            message: rej.reason.replace(`${reasonCode}: `, ""),
            context: { source: "rejected_fallback" }
          }
        ],
        appSlug: appInference.appSlug,
        appProfilePath: appProfileResult.appConfigPath,
        suggestedAction
      });

      fallbackCount++;
      console.log(`[blocked-scenarios] added sourceIssueKey=${rej.sourceIssueKey} reasonCode=${reasonCode} source=rejected_fallback`);
    }
  }

  console.log(`[blocked-scenarios] fromRouteResolutions=${blockedScenarios.length - fallbackCount} fromRejectedFallback=${fallbackCount} total=${blockedScenarios.length}`);

  // Check route mismatch for catalog-seeds guard after blockedScenarios is available
  const hasRouteMismatchForSeeds = blockedScenarios.some(b => b.reasonCode === "route_profile_intent_mismatch" || b.reason === "route_profile_intent_mismatch");
  if (!isCatalogIntent || hasRouteMismatchForSeeds) {
    console.log(`[catalog-seeds] skipped reason=intent_mismatch_or_non_catalog_intent huIntent=${primaryIssueIntent.intent}`);
  }

  const validated: ValidatedScenario[] = [];
  let validCount = 0;
  let invalidCount = 0;

  // Detect primary HU intent for guard logic
    console.log(`[scenario-preview] discovery disabled reason=preview_uses_hu_ai_and_knowledge_context`);
  console.log(`[scenario-preview] routePendingBuilder architecture=hu_generates_scenarios_knowledge_completes_route`);

  // Load knowledge context for historical hints (not for discovery)
  const huTextForContext = issues.length > 0 ? [issues[0].summary, issues[0].description, issues[0].acceptanceCriteria || ""].filter(Boolean).join(" ") : "";

  // Diagnostic: extract rich HU model (used for intent refinement before resolver)
  huModel = huTextForContext ? extractHuScenarioModel(huTextForContext) : null;
  const huExplicitRoutePath: string[] = huTextForContext ? extractExplicitRoutePath(huTextForContext) : [];
  if (huModel) {
    console.log(`[scenario-preview] huModel intent=${huModel.mainIntent} subIntent=${huModel.subIntent} uiObligations=${huModel.uiObligations.length} nonUiRequirements=${huModel.nonUiRequirements.length}`);
    console.log(`[scenario-preview] huModel screens=${huModel.requiredScreens.length} fields=${huModel.requiredFields.length} selectable=${huModel.selectableEntities.length} buttons=${huModel.visibleButtons.length} warnings=${huModel.visibleWarnings.length} delivery=${huModel.deliverySignals}`);
    scenarioPlan = buildRoutePendingScenarioPlan(huModel);
    console.log(`[scenario-preview] huPlan complexity=${scenarioPlan.complexity} target=${scenarioPlan.scenarioCountTarget} variants=${scenarioPlan.variants.join(",")}`);
    console.log(`[scenario-preview] huPlan requirements data=${scenarioPlan.dataRequirements.length} excludedNonUi=${scenarioPlan.excludedNonUiRequirements.length}`);
  }
  // Store explicit route path on huModel for downstream use
  if (huExplicitRoutePath.length > 0 && huModel) {
    (huModel as any).explicitRoutePath = huExplicitRoutePath;
    console.log(`[hu-route] explicitRoutePath issue=${issues[0]?.key ?? "unknown"} path="${huExplicitRoutePath.join(" > ")}"`);
  }

  // Pass refined intent to knowledge context resolver (prefer huModel over primaryIssueIntent)
  const resolverIntent = huModel?.mainIntent && huModel.mainIntent !== "generic"
    ? huModel.mainIntent
    : primaryIssueIntent.intent;
  console.log(`[scenario-preview] resolverIntent=${resolverIntent} source=${huModel?.mainIntent !== "generic" && huModel?.mainIntent ? "huModel" : "primaryIssueIntent"}`);
  const knowledgeCtx = buildKnowledgeContextForScenarioGeneration(appInference.appSlug, huTextForContext, resolverIntent);

  // -- Check if route profile mismatch generate routePending fallback scenarios --
  const hasRouteMismatch = blockedScenarios.some(b => b.reasonCode === "route_profile_intent_mismatch" || b.reason === "route_profile_intent_mismatch" || b.suggestedAction === "run_transactional_route_discovery");
  const aiRejectedAllByQuality =
    generationResult?.generationDiagnostics?.aiCalled === true &&
    (generationResult?.generationDiagnostics?.finalValid ?? 0) === 0 &&
    (generationResult?.generationDiagnostics?.finalRejected ?? 0) > 0 &&
    issues.length > 0;
  let shouldFallback = validCount === 0 && rawScenarios.length === 0 && hasRouteMismatchForSeeds;
  let fallbackReason: string | undefined;
  if (aiRejectedAllByQuality && !shouldFallback) {
    shouldFallback = true;
    fallbackReason = "ai_rejected_all_by_quality";
  } else if (shouldFallback && hasRouteMismatchForSeeds) {
    fallbackReason = "route_profile_intent_mismatch";
  }
  console.log(`[scenario-preview] routePendingBuilder fallbackDecision hasRouteMismatch=${hasRouteMismatchForSeeds} aiRejectedAllByQuality=${aiRejectedAllByQuality} rawScenarios=${rawScenarios.length} valid=${validCount} shouldGenerate=${shouldFallback} issues=${issues.length}`);
  if (fallbackReason) {
    console.log(`[scenario-preview] routePendingBuilder fallbackReason=${fallbackReason}`);
  }
  let routePendingCount = 0;

  // Build prefix from knowledge context if available
  let candidatePrefixSteps;
  if (knowledgeCtx.available && knowledgeCtx.navigationHints.length > 0) {
    candidatePrefixSteps = knowledgeCtx.navigationHints[0].clickTargets;
    console.log(`[scenario-preview] routePendingBuilder prefixApplied source=app.knowledge steps=${knowledgeCtx.navigationHints[0].clickTargets.length} authStep=${knowledgeCtx.navigationHints[0].authTerms.length > 0}`);
  }

  if (shouldFallback && issues.length > 0) {
    const fallbackScenarios = generateRoutePendingScenarios(
      issues[0], resolverIntent, fallbackReason ?? "route_profile_intent_mismatch",
      candidatePrefixSteps ? "knowledge_prefix_pending" : "missing_initial_route",
      appInference.appSlug, candidatePrefixSteps,
      huModel, scenarioPlan,
      huExplicitRoutePath,
    );
    for (const fb of fallbackScenarios) {
      validated.push({ ...fb, validation: { valid: true, errors: [] } });
      routePendingCount++;
    }
    console.log(`[scenario-preview] routePendingBuilder fallbackScenarios=${fallbackScenarios.length}`);
    console.log(`[scenario-preview] routePendingBuilder attached=${fallbackScenarios.length} finalVisible=${validated.length}`);
  }

console.log(`[scenarios:preview] beforeValidation rawScenarios=${rawScenarios.length}`);

  // Normalize encoding before validation to fix mojibake
  const { detectMojibake } = await import("./target-normalization");
  const encodingNormalizedScenarios = rawScenarios.map((sc) => {
    const normalizedSteps = sc.steps?.map((step) => {
      const fixed = detectMojibake(step);
      return fixed.hasMojibake ? fixed.corrected : step;
    }) ?? [];

    const fixedTitle = detectMojibake(sc.title);

    return {
      ...sc,
      steps: normalizedSteps,
      title: fixedTitle.hasMojibake ? fixedTitle.corrected : sc.title,
    };
  });

  console.log(`[scenarios:preview] encodingNormalized=${encodingNormalizedScenarios.length}`);

  // Apply automatability filter BEFORE validation
  // Only UI-automatable scenarios can proceed to preview
  const { filterScenariosByAutomatability } = await import("./scenario-automatability-classifier");

  // Use first issue as HU context for classification
  const huContextForClassification = issues.length > 0 ? issues[0] : undefined;

  const { automatable: automatableScenarios, excluded: excludedRequirements } =
    filterScenariosByAutomatability(encodingNormalizedScenarios, huContextForClassification);

  console.log(
    `[scenarios:automatability] total=${encodingNormalizedScenarios.length} ` +
      `automatable=${automatableScenarios.length} excluded=${excludedRequirements.length}`
  );

  // Update catalogDiagnostics with excluded requirements
  if (catalogDiagnostics) {
    catalogDiagnostics.excludedRequirements = excludedRequirements;
    catalogDiagnostics.nonAutomatableRequirementCount = excludedRequirements.length;
    catalogDiagnostics.uiAutomatableRequirementCount = automatableScenarios.length;
  }

  // ── AI scenario prefix repair: inject knowledge prefix + HU explicit route ──
  // For non-catalog intents, also filter catalog-contaminated labels
  const isPrivateOrBalanceIntent = primaryIssueIntent.intent !== "catalog_listing_flow" &&
    primaryIssueIntent.intent !== "product_detail_flow";

  // Detect routeProfile catalog orientation via structural signals (not just label heuristics)
  const routeProfileFlavor = detectRouteProfileIsCatalog(resolvedRouteProfile, knowledgeCtx.available ? undefined : undefined);
  const routeProfileIsCatalog = routeProfileFlavor.isCatalog;
  console.log(`[scenario-preview] routeProfile compatibility=${routeProfileIsCatalog ? "compatible" : "incompatible"} intent=${primaryIssueIntent.intent} reason=${routeProfileFlavor.reason} confidence=${routeProfileFlavor.confidence}`);

  if (isPrivateOrBalanceIntent && routeProfileIsCatalog) {
    console.log(`[scenario-preview] ignoredRequiredEntryStep reason=private_intent_catalog_profile compatibility=${routeProfileFlavor.confidence} signals="${routeProfileFlavor.reason}"`);
  }

  // Build required prefix from app.knowledge + HU breadcrumb, deduplicated
  const normLabel = (l: string) => l.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const requiredPrefix: string[] = [];
  const includedLabels = new Set<string>();

  // 1. Knowledge prefix (validated navigation from app.knowledge)
  if (candidatePrefixSteps && candidatePrefixSteps.length > 0) {
    for (const t of candidatePrefixSteps) {
      requiredPrefix.push(`Clic en "${t}".`);
      includedLabels.add(normLabel(t));
    }
  }

  // 2. HU explicit route (breadcrumb from HU text)
  if (huExplicitRoutePath.length > 0) {
    let added = 0;
    for (const seg of huExplicitRoutePath) {
      const ns = normLabel(seg);
      if (!includedLabels.has(ns)) {
        requiredPrefix.push(`Clic en "${seg}".`);
        includedLabels.add(ns);
        added++;
      }
    }
    if (added > 0) {
      console.log(`[scenario-preview] aiRoutePrefixRepair huRouteAdded=${added}`);
    }
  }

  // 3. Apply prefix to ALL AI scenarios that don't already have it
  if (requiredPrefix.length > 0 && automatableScenarios.length > 0) {
    let repairedCount = 0;
    const catalogContaminationTerms = isPrivateOrBalanceIntent
      ? /nombre del producto|beneficios|requisitos|solicitar|descripci[oó]n general|informaci[oó]n de productos|volver al listado de productos|cuentas de efectivo|d[oó]lares|euros|pesos/i
      : null;
    let contaminationRemoved = 0;

    // Build set of labels protected from contamination removal
    // Sources: HU explicit route, required prefix, huModel fields/buttons/screens
    const protectedLabels = new Set<string>();
    for (const seg of huExplicitRoutePath) protectedLabels.add(normLabel(seg));
    for (const ps of requiredPrefix) {
      const m = ps.match(/Clic en "(.+)"\./i);
      if (m) protectedLabels.add(normLabel(m[1]));
    }
    if (huModel) {
      for (const f of (huModel.selectableEntities ?? [])) protectedLabels.add(normLabel(f));
      for (const f of (huModel.visibleButtons ?? [])) protectedLabels.add(normLabel(f));
      for (const f of (huModel.visibleWarnings ?? [])) protectedLabels.add(normLabel(f));
      for (const f of (huModel.visibleOptions ?? [])) protectedLabels.add(normLabel(f));
      for (const f of (huModel.requiredScreens ?? [])) protectedLabels.add(normLabel(f));
      for (const f of (huModel.requiredFields ?? [])) protectedLabels.add(normLabel(f));
    }

    // Helper: extract quoted label from MCP step
    const extractLabel = (step: string): string | null => {
      const m = step.match(/"(.+?)"/);
      return m ? normLabel(m[1]) : null;
    };

    for (const sc of automatableScenarios) {
      let existingSteps = (sc.steps ?? []).map((s: string) => s.replace(/^\d+[\.)]\s*/, "").trim());
      let modified = false;

      // Remove catalog contamination for non-catalog intents
      if (catalogContaminationTerms && existingSteps.length > 0) {
        const before = existingSteps.length;
        existingSteps = existingSteps.filter((s: string) => {
          // Preserve loan/balance-specific labels
          if (/prestamo|balance|tasa|monto|saldo|cuota|plazo|fecha|pago|desembolsado|cancelacion|amortizacion|correo|imprimir|volver/i.test(s)) return true;
          if (catalogContaminationTerms.test(s)) {
            // Check if label is protected by HU explicit route/prefix/model
            const label = extractLabel(s);
            if (label && protectedLabels.has(label)) {
              console.log(`[scenario-preview] contaminationPreserved reason=hu_protected_label target="${label}"`);
              return true;
            }
            return false;
          }
          return true;
        });
        const removed = before - existingSteps.length;
        if (removed > 0) {
          contaminationRemoved += removed;
          modified = true;
        }
      }

      // Remove clicks from existingSteps already covered by requiredPrefix (avoids duplicates)
      if (requiredPrefix.length > 0) {
        const prefixTargets = new Set<string>();
        for (const ps of requiredPrefix) {
          const m = ps.match(/Clic en "(.+)"\./i);
          if (m) prefixTargets.add(normLabel(m[1]));
        }
        const beforeFilter = existingSteps.length;
        existingSteps = existingSteps.filter((s: string) => {
          const clickMatch = s.match(/^Clic en "(.+)"\.?$/i);
          if (clickMatch && prefixTargets.has(normLabel(clickMatch[1]))) {
            return false;
          }
          return true;
        });
        const duplicateClicksRemoved = beforeFilter - existingSteps.length;
        if (duplicateClicksRemoved > 0) {
          console.log(`[scenario-preview] aiRoutePrefixRepair duplicatePrefixClicksRemoved=${duplicateClicksRemoved} scenarioTitle="${sc.title?.substring(0, 60)}"`);
        }
      }

      // Check which prefix steps are missing
      const existingNorm = new Set(existingSteps.map(normLabel));
      let missingPrefix: string[] = [];
      for (const ps of requiredPrefix) {
        const clickMatch = ps.match(/Clic en "(.+)"\./i);
        if (clickMatch && !existingNorm.has(normLabel(clickMatch[1]))) {
          missingPrefix.push(ps);
        }
      }
      // Remove special-case for "Iniciar" — now handled generically by the filter above

      if (missingPrefix.length > 0) {
        // Prepend missing prefix steps to existing steps
        const newSteps = [...missingPrefix, ...existingSteps];
        // Re-number
        sc.steps = newSteps.map((s, i) => {
          const stripped = s.replace(/^\d+[\.)]\s*/, "");
          return `${i + 1}. ${stripped}`;
        });
        modified = true;
      } else if (modified) {
        // Just re-number after contamination removal
        if (existingSteps.length > 0) {
          sc.steps = existingSteps.map((s, i) => {
            const stripped = s.replace(/^\d+[\.)]\s*/, "");
            return `${i + 1}. ${stripped}`;
          });
        }
      }

      if (modified) repairedCount++;

      // Trace: log first 6 steps after repair for auditability
      if (modified && sc.steps && sc.steps.length > 0) {
        const preview = sc.steps.slice(0, 6);
        console.log(`[scenario-preview] afterAiRoutePrefixRepair scenarioTitle="${sc.title?.substring(0, 80)}" firstSteps=${JSON.stringify(preview)}`);
      }
    }

    if (repairedCount > 0) {
      console.log(`[scenario-preview] aiRoutePrefixRepair requiredSteps=${requiredPrefix.length} scenarios=${repairedCount}`);
      if (contaminationRemoved > 0) {
        console.log(`[scenario-preview] aiRoutePrefixRepair contaminationRemoved=${contaminationRemoved} scenarios=${repairedCount}`);
      }
    }
  }

  // Only validate and process automatable scenarios
  // For non-catalog intents (private/balance), skip public routeProfile entry steps
  for (const sc of automatableScenarios) {
    const validation = validateScenario(
      sc,
      isPrivateOrBalanceIntent ? null : resolvedRouteProfile,
      undefined, undefined, undefined,
      isPrivateOrBalanceIntent ? true : undefined,
    );
    if (validation.valid) {
      validCount++;
    } else {
      invalidCount++;
      console.log(
        `[scenarios:preview] scenarioValidationFailed sourceIssueKey=${sc.sourceIssueKey} ` +
        `title="${sc.title}" errors=${JSON.stringify(validation.errors)}`
      );
      warnings.push(`Scenario "${sc.title}" failed validation: ${validation.errors.join("; ")}`);
    }
    validated.push({ ...sc, validation });
  }

  console.log(
    `[scenarios:preview] generated ${validated.length} scenarios valid=${validCount} routePending=${routePendingCount} automationReady=${validCount} blocked=${blockedScenarios.length}`,
  );

  // ── Post-validation fallback: under-generated or all-rejected ──
  const routePendingFallbackAlreadyGenerated = shouldFallback;
  const aiCalled = generationResult?.generationDiagnostics?.aiCalled === true;
  const aiGeneratedCount = (generationResult?.generationDiagnostics?.aiGenerated ?? 0);
  const scenarioTarget = huModel?.scenarioPlan?.scenarioCountTarget ?? scenarioPlan?.scenarioCountTarget ?? 0;
  const aiUnderGeneratedTarget = aiCalled && scenarioTarget > 0 &&
    aiGeneratedCount < Math.ceil(scenarioTarget * 0.6) && validCount < 3;
  const previewValidationZeroAfterAI = aiCalled && aiGeneratedCount > 0 && validCount === 0;
  const needsPostValidationFallback = !routePendingFallbackAlreadyGenerated &&
    (aiUnderGeneratedTarget || previewValidationZeroAfterAI) && issues.length > 0;

  if (aiUnderGeneratedTarget && routePendingFallbackAlreadyGenerated) {
    console.log(`[scenario-preview] postValidationFallback skipped reason=fallback_already_generated previousReason=${fallbackReason ?? "ai_rejected_all_by_quality"}`);
  } else if (aiUnderGeneratedTarget) {
    console.log(`[scenario-preview] fallbackReason=ai_under_generated_target target=${scenarioTarget} aiGenerated=${aiGeneratedCount}`);
  }
  if (previewValidationZeroAfterAI) {
    console.log(`[scenario-preview] fallbackReason=preview_validation_zero_after_ai`);
  }

  if (needsPostValidationFallback) {
    const postFallbackReason = aiUnderGeneratedTarget
      ? "ai_under_generated_target" : "preview_validation_zero_after_ai";
    const postFallbackScenarios = generateRoutePendingScenarios(
      issues[0], resolverIntent, postFallbackReason,
      candidatePrefixSteps ? "knowledge_prefix_pending" : "missing_initial_route",
      appInference.appSlug, candidatePrefixSteps,
      huModel, scenarioPlan,
      huExplicitRoutePath,
    );
    for (const fb of postFallbackScenarios) {
      validated.push({ ...fb, validation: { valid: true, errors: [] } });
      routePendingCount++;
    }
    console.log(`[scenario-preview] routePendingBuilder postValidationFallback reason=${postFallbackReason} added=${postFallbackScenarios.length} totalRoutePending=${routePendingCount}`);
  }

  // Log generation diagnostics if available
  if (generationResult.generationDiagnostics) {
    const diag = generationResult.generationDiagnostics;
    // Merge service-layer fallback into diagnostics for accurate reporting
    const effectiveFallbackUsed = diag.fallbackUsed || shouldFallback || needsPostValidationFallback;
    const effectiveFallbackReason = diag.fallbackReason ?? fallbackReason ?? (needsPostValidationFallback ? (aiUnderGeneratedTarget ? "ai_under_generated_target" : "preview_validation_zero_after_ai") : undefined);
    console.log(
      `[scenarios:diagnostics] mode=${diag.generationMode} ` +
      `aiCalled=${diag.aiCalled} aiFailed=${diag.aiFailed ?? false} ` +
      `aiGenerated=${diag.aiGenerated} finalValid=${diag.finalValid} ` +
      `finalRejected=${diag.finalRejected} finalBlocked=${diag.finalBlocked} ` +
      `fallbackUsed=${effectiveFallbackUsed} fallbackReason=${effectiveFallbackReason ?? "none"}`
    );
  }

  // Log state mapping diagnostic
  console.log(
    `[scenarios:state-mapping] ` +
    `generationValid=${generationResult.generationDiagnostics?.finalValid ?? "unknown"} ` +
    `previewValid=${validCount} ` +
    `difference=${(generationResult.generationDiagnostics?.finalValid ?? 0) - validCount}`
  );

  // Enhance catalogDiagnostics with detailed metrics (Correction 5)
  if (catalogDiagnostics && issues.length > 0 && routeProfileForGeneration?.targetPaths) {
    const { filterTargetPathsByIssueScope } = await import("./scenario-hu-scope-filter");
    const { calculateDynamicScenarioLimit } = await import("./mcp-scenario-prompt-builder");
    const issueContext = issues[0];

    // HU scope filtering diagnostics
    const { alignedTargetPaths, diagnostics: scopeDiagnostics } = filterTargetPathsByIssueScope(
      issueContext,
      routeProfileForGeneration.targetPaths,
      routeProfileForGeneration
    );

    // Extract aligned categories
    const categorySet = new Set<string>();
    const explicitlyMentionedSet = new Set<string>();

    for (const tp of Object.values(alignedTargetPaths)) {
      if (tp.productMetadata?.category) {
        categorySet.add(tp.productMetadata.category);
      }
    }

    // Detect explicitly mentioned categories (from scope filter diagnostics)
    if (scopeDiagnostics.matchedKeywords && scopeDiagnostics.matchedKeywords.length > 0) {
      // Check which aligned categories were explicitly mentioned in HU
      const huCorpus = (issueContext.summary + " " + issueContext.description + " " + (issueContext.acceptanceCriteria || ""))
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      for (const category of categorySet) {
        const normalizedCategory = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (huCorpus.includes(normalizedCategory)) {
          explicitlyMentionedSet.add(category);
        }
      }
    }

    catalogDiagnostics.issueAlignedTargetCount = scopeDiagnostics.alignedProducts;
    catalogDiagnostics.issueAlignedCategories = Array.from(categorySet);
    catalogDiagnostics.explicitlyMentionedCategories = Array.from(explicitlyMentionedSet);

    // Scenario budget diagnostics
    const alignedCategories = Array.from(categorySet);
    const dynamicScenarioLimit = calculateDynamicScenarioLimit(issues, routeProfileForGeneration, alignedCategories);

    catalogDiagnostics.scenarioBudgetResolved = dynamicScenarioLimit;
    catalogDiagnostics.scenarioBudgetSource = process.env.AI_SCENARIO_MAX_PER_ISSUE
      ? "env_override"
      : alignedCategories.length > 2
      ? "dynamic_broad_hu"
      : "default";

    // Seed context diagnostics (using generationSource, not sourceIssueKey)
    const seedScenarios = rawScenarios.filter((s) => s.generationSource === "deterministic_seed");
    const validatedSeeds = validated.filter((s) => s.generationSource === "deterministic_seed");
    const validSeeds = validatedSeeds.filter((s) => s.validation.valid);
    const invalidSeeds = validatedSeeds.filter((s) => !s.validation.valid);

    catalogDiagnostics.seedContextCount = seedScenarios.length;

    if (seedScenarios.length > 0) {
      const seedsByCategory: Record<string, number> = {};
      for (const seed of seedScenarios) {
        // Extract category from seed steps by matching against aligned products
        for (const [target, tp] of Object.entries(alignedTargetPaths)) {
          if (seed.steps?.some((step) => step.includes(target)) && tp.productMetadata?.category) {
            const cat = tp.productMetadata.category;
            seedsByCategory[cat] = (seedsByCategory[cat] || 0) + 1;
            break; // Only count once per seed
          }
        }
      }
      catalogDiagnostics.seedContextByCategory = seedsByCategory;

      // Add detailed seed diagnostics
      catalogDiagnostics.seedGeneratedCount = seedScenarios.length;
      catalogDiagnostics.seedValidCount = validSeeds.length;
      catalogDiagnostics.seedInvalidCount = invalidSeeds.length;

      if (invalidSeeds.length > 0) {
        catalogDiagnostics.seedInvalidReasons = invalidSeeds.map((s) => ({
          title: s.title,
          errors: s.validation.errors,
        }));
      }

      console.log(
        `[scenarios:seed-diagnostics] generated=${seedScenarios.length} ` +
          `valid=${validSeeds.length} invalid=${invalidSeeds.length}`
      );
    }

    // Coverage diagnostics (category-level coverage analysis)
    const categoryCoverage: Record<string, { total: number; covered: number; seeded: number }> = {};

    for (const category of categorySet) {
      const categoryProducts = Object.entries(alignedTargetPaths).filter(
        ([_, tp]) => tp.productMetadata?.category === category
      );

      const coveredProducts = new Set<string>();
      const seededProducts = new Set<string>();

      for (const scenario of rawScenarios) {
        const isSeeded = scenario.generationSource === "deterministic_seed";

        for (const [target, _tp] of categoryProducts) {
          if (scenario.steps?.some((step) => step.includes(`"${target}"`) || step.includes(`'${target}'`))) {
            coveredProducts.add(target);
            if (isSeeded) {
              seededProducts.add(target);
            }
          }
        }
      }

      categoryCoverage[category] = {
        total: categoryProducts.length,
        covered: coveredProducts.size,
        seeded: seededProducts.size,
      };
    }

    catalogDiagnostics.categoryCoverage = categoryCoverage;

    // Failure scenario diagnostics
    const huText = issueContext.summary + " " + issueContext.description + " " + (issueContext.acceptanceCriteria || "");
    const failurePatternMatches = huText.match(/escenario\s+(?:de\s+)?(?:fallo|error|negativ[oa]|excepci[oó]n)/gi);
    catalogDiagnostics.failureScenarioCountDetected = failurePatternMatches?.length || 0;

    const failureScenarios = rawScenarios.filter((s) =>
      s.title?.toLowerCase().includes("error") ||
      s.title?.toLowerCase().includes("fallo") ||
      s.title?.toLowerCase().includes("negativ") ||
      s.title?.toLowerCase().includes("excepción") ||
      s.title?.toLowerCase().includes("inválid")
    );
    catalogDiagnostics.failureScenarioCountGenerated = failureScenarios.length;

    console.log(
      `[scenarios:diagnostics] issueAligned=${catalogDiagnostics.issueAlignedTargetCount} ` +
      `categories=${catalogDiagnostics.issueAlignedCategories?.length} ` +
      `scenarioBudget=${catalogDiagnostics.scenarioBudgetResolved} ` +
      `seedContext=${catalogDiagnostics.seedContextCount} ` +
      `failureDetected=${catalogDiagnostics.failureScenarioCountDetected} ` +
      `failureGenerated=${catalogDiagnostics.failureScenarioCountGenerated}`
    );
  }

  return {
    ok: true,
    source: {
      mode: req.sourceMode ?? "jira",
      projectKey: req.projectKey,
      sprintId,
      status: req.status ?? null,
      issuesFound: issues.length,
    },
    testrail: {
      projectId: req.testrailProjectId ?? null,
      suiteId: req.testrailSuiteId ?? null,
      sectionId: req.testrailSectionId ?? null,
      sectionName: req.testrailSectionName ?? null,
    },
    appSlug: effectiveAppSlug,
    targetAppSlug: appInference.appSlug,
    targetAppName: appInference.appName,
    appInference,
    appProfilePath: appProfileResult.appConfigPath,
    summary: {
      generated: validated.length,
      valid: validCount,
      invalid: invalidCount,
      rejected: rejected.length,
      blocked: blockedScenarios.length,
      routePending: routePendingCount,
      automationReady: validCount,
    },
    routeProfile: resolvedRouteProfile,
    scenarios: validated,
    rejected,
    blockedScenarios,
    warnings,
    catalogDiagnostics,
};

/**
 * Detect if a routeProfile is catalog/listing oriented using structural signals,
 * not just label heuristics. Returns confidence: high, medium, or low.
 */
function detectRouteProfileIsCatalog(
  routeProfile: any,
  knowledgeItems?: any[],
): { isCatalog: boolean; confidence: "high" | "medium" | "low"; reason: string } {
  if (!routeProfile) return { isCatalog: false, confidence: "low", reason: "no_route_profile" };

  // ── Structural signals (weighted) ──
  let score = 0;
  const signals: string[] = [];

  // 1. targetPaths with product groups → strong catalog signal
  const targetPaths = (routeProfile.targetPaths ?? {});
  const targetPathKeys = Object.keys(targetPaths);
  if (targetPathKeys.length >= 3) { score += 3; signals.push("targetPaths_rich"); }
  else if (targetPathKeys.length >= 1) { score += 2; signals.push("targetPaths_present"); }

  // 2. targetPaths have productMetadata (subcategory, detailSections, etc.) → very strong
  const hasProductMetadata = targetPathKeys.some(
    (k: string) => !!(targetPaths[k] as any)?.productMetadata?.subcategory
  );
  if (hasProductMetadata) { score += 3; signals.push("product_metadata"); }

  // 3. entry labels contain catalog-pattern business keys (underscore format)
  const entries = (routeProfile.entry ?? []) as any[];
  const entryLabels = entries.map((e: any) =>
    (e.businessLabel ?? e.visibleLabel ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  );
  const catalogEntryPatterns = [/informacion_de_productos/, /productos/, /catalogo/];
  const hasCatalogEntry = entryLabels.some(l => catalogEntryPatterns.some(p => p.test(l)));
  if (hasCatalogEntry) { score += 1; signals.push("catalog_entry_label"); }

  // 4. visibleControls dominated by catalog section labels (Beneficios, Requisitos, etc.)
  const controls = (routeProfile.visibleControls ?? []) as string[];
  if (controls.length >= 5) {
    const catalogSectionTerms = /beneficios|requisitos|condiciones relevantes|descripci[oó]n general|informaci[oó]n legal|nombre del producto|solicitar|tasas/i;
    const catalogControls = controls.filter((c: string) => catalogSectionTerms.test(c));
    const ratio = catalogControls.length / Math.max(controls.length, 1);
    if (ratio >= 0.3) { score += 1; signals.push(`catalog_controls_ratio=${ratio.toFixed(1)}`); }
  }

  // 5. knowledge items signal compatible intent
  if (knowledgeItems && knowledgeItems.length > 0) {
    const hasFunctionalIntent = knowledgeItems.some(
      (k: any) => /intent:functional|intent:catalog/i.test((k.coverageRefs ?? []).join(" ")));
    if (hasFunctionalIntent) { score += 1; signals.push("knowledge_intent_functional"); }
  }

  const isCatalog = score >= 2;
  const confidence: "high" | "medium" | "low" =
    score >= 5 ? "high" : score >= 3 ? "medium" : "low";
  const reason = `score=${score} (${signals.join(", ") || "no_signals"})`;

  return { isCatalog, confidence, reason };
}

/**
 * Extract structured entities from HU text for scenario generation.
 * Multiproject - no hardcoded apps, modules or specific labels.
 */
function extractHuEntities(text: string): {
  documentType: string | null;
  action: string | null;
  requiredData: string[];
  hasPreview: boolean;
  hasConfirmation: boolean;
  hasCancel: boolean;
} {
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const docs: [RegExp, string][] = [
    [/(?:carta\s+de\s+referencia\s+bancaria|carta\s+de\s+referencia)/i, "carta de referencia bancaria"],
    [/(?:estado\s+de\s+cuenta|extracto|movimiento)/i, "estado de cuenta"],
    [/carta/i, "carta"], [/certificacion|certificado/i, "certificacion"],
    [/constancia/i, "constancia"], [/comprobante/i, "comprobante"],
    [/documento/i, "documento"], [/reporte/i, "reporte"],
  ];
  let documentType: string | null = null;
  for (const [p, l] of docs) { if (p.test(lower)) { documentType = l; break; } }

  const acts: [RegExp, string][] = [
    [/(?:generar|emitir)\s+(?:una\s+)?(?:carta|certificacion|documento)/i, "Generar"],
    [/(?:descargar|exportar|imprimir)\s+(?:una\s+)?(?:carta|documento|reporte)/i, "Descargar"],
    [/(?:transferir|pagar|enviar)\s+(?:fondos|dinero|pago|monto)/i, "Transferir"],
    [/(?:registrar|crear|solicitar|contratar)\s+(?:una\s+)?(?:cuenta|tarjeta|producto)/i, "Solicitar"],
    [/(?:consultar|visualizar|ver)\s+(?:el\s+)?(?:saldo|estado|detalle)/i, "Consultar"],
  ];
  let action: string | null = null;
  for (const [p, v] of acts) { if (p.test(lower)) { action = v; break; } }

  const dataSignals: [RegExp, string][] = [
    [/\bdestinatario\b/i, "destinatario"], [/\brnc\b/i, "RNC"],
    [/\bcorreo\b|\bemail\b/i, "correo"], [/\bcuenta\b/i, "cuenta"],
    [/\bmonto\b/i, "monto"], [/\bmoneda\b/i, "moneda"],
    [/\bfecha\b/i, "fecha"], [/\bidioama\b/i, "idioma"],
    [/\bmotivo\b/i, "motivo"], [/\bperiodo\b/i, "periodo"],
    [/\brango\b/i, "rango de fechas"],
  ];
  const requiredData: string[] = [];
  for (const [p, l] of dataSignals) { if (p.test(lower) && !requiredData.includes(l)) requiredData.push(l); }

  const hasPreview = /\bvista\s+previa\b/i.test(lower);
  const hasConfirmation = /\bconfirmar\b|\bconfirmacion\b|\baceptar\b|\bgenerar\b/i.test(lower);
  const hasCancel = /\bcancelar\b|\bvolver\b|\bcancelacion\b|\bdescartar\b/i.test(lower);

  return { documentType, action, requiredData, hasPreview, hasConfirmation, hasCancel };
}

/**
 * Generate route-pending scenarios by intent. The HU determines intent, action and validations.
 * app.knowledge only supplies the navigation prefix. No discovery, no browser, no Playwright.
 */
function generateRoutePendingScenarios(
  issue: any, huIntent: string, reasonCode: string,
  routeStatus: "knowledge_prefix_pending" | "missing_initial_route",
  appSlug?: string, candidatePrefixSteps?: string[],
  huModel?: any, scenarioPlan?: any,
  huExplicitRoutePath?: string[],
): any[] {
  // If scenarioPlan is available, use plan-based dynamic generation
  // Exception: display-only intents (balance_inquiry, catalog, detail) skip plan-based
  // because they don't require form fills, confirmations, or data entry flows
  const isDisplayOnlyIntent = huIntent === "balance_inquiry" || huIntent === "catalog_listing" ||
    huIntent === "product_detail_flow" || /loan|balance/i.test(huIntent);
  if (scenarioPlan && !isDisplayOnlyIntent) {
    return buildPlanBasedScenarios(issue, huIntent, reasonCode, routeStatus, appSlug, candidatePrefixSteps, huModel, scenarioPlan);
  }

  const summary = issue.summary ?? "";
  const desc = issue.description ?? "";
  const criteria = issue.acceptanceCriteria ?? "";
  const huText = [summary, desc, criteria].filter(Boolean).join(" ");
  const huLower = huText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const entities = extractHuEntities(huText);
  const key = issue.key;
  const dType = entities.documentType ?? "la operacion";
  const required = entities.requiredData;
  const scenarios: any[] = [];

  const baseFields = { type: "functional", database: "", isConverted: 0,
    automationType: "ui_discovery", setupStrategy: "no_login",
    appSlug: appSlug ?? "unknown", targetAppSlug: appSlug ?? "unknown",
    routeProfile: "", dataRequirements: "", nonExecutableCriteria: "requires_route_discovery",
    mcpExecutable: false, generationSource: "fallback" as const };

  function prefixSteps(): string[] {
    const s: string[] = [];
    const normalize = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const alreadyIncluded = new Set<string>();

    // 1. Knowledge prefix (validated navigation prefix from app.knowledge)
    if (candidatePrefixSteps && candidatePrefixSteps.length > 0) {
      for (const t of candidatePrefixSteps) {
        const step = `Clic en "${t}".`;
        s.push(step);
        alreadyIncluded.add(normalize(t));
      }
    } else if (routeStatus === "knowledge_prefix_pending") {
      s.push("Ingresar al area funcional usando el prefijo de navegacion validado.");
    }

    // 2. HU explicit route (breadcrumb from HU text, e.g., "Consulta de balance > Préstamos")
    const routePath = huExplicitRoutePath ?? (huModel as any)?.explicitRoutePath ?? [];
    if (routePath.length > 0) {
      let addedCount = 0;
      for (const seg of routePath) {
        const normSeg = normalize(seg);
        if (!alreadyIncluded.has(normSeg)) {
          const step = `Clic en "${seg}".`;
          s.push(step);
          alreadyIncluded.add(normSeg);
          addedCount++;
        }
      }
      if (addedCount > 0) {
        console.log(`[scenario-preview] routePendingBuilder huRouteApplied steps=${addedCount} path="${routePath.join(" > ")}"`);
      }
    }

    if (s.length > 1 && (candidatePrefixSteps?.length ?? 0) > 0 && (routePath.length > 0)) {
      console.log(`[scenario-preview] routePendingBuilder finalPrefix source=knowledge+huRoute steps=${s.length}`);
    }

    if (/auth|identificac|login|otp|contrase/i.test(huLower)) s.push("Completar la autenticacion requerida.");
    return s;
  }
  const pfx = prefixSteps();
  const dataStep = required.length > 0 ? [required.length > 2 ? `Completar los datos requeridos: ${required.join(", ")}.` : `Completar ${required.join(" y ")}.`] : [];

  // Detect sub-intent
  const isBalance = /balance|saldo/.test(huLower) && /\\b(cuenta|producto|tarjeta)\\b/.test(huLower);
  const isStatement = /estado de cuenta|extracto|movimiento/.test(huLower);
  const isPayment = /transferir|transferencia|pagar|pago/.test(huLower) || (/enviar/.test(huLower) && /fondos|dinero/.test(huLower));
  const isRegistration = /registrar|crear|solicitar|contratar|apertura/.test(huLower) && /\\b(cuenta|tarjeta|producto|servicio)\\b/.test(huLower);
  const isMaintenance = /editar|modificar|cambiar|actualizar|eliminar|desactivar/.test(huLower);
  const isCatalog = huIntent === "catalog_listing_flow" || /listado|catalogo|productos?|categorias/i.test(huLower);

  console.log(`[scenario-preview] routePendingBuilder intent=${huIntent} strategy=intent_specific`);

  // Intent-specific generators
  function add(title: string, steps: string[], preconds: string[], expected: string) {
    scenarios.push({ ...baseFields, sourceIssueKey: key,
      title: `${summary || "Flujo principal"} \u2014 ${title}`,
      steps: [...pfx, ...steps],
      preconditions: ["El usuario esta autenticado en la aplicacion." + (preconds.length ? " " + preconds.join(" ") : "")],
      expectedResult: expected });
  }

  if (huIntent === "balance_inquiry" || /balance|loan/.test(huIntent)) {
    const isLoan = /prestamo/.test(huLower) || /loan/i.test(huIntent);
    console.log(`[scenario-preview] routePendingBuilder intent=${huIntent} variants=${isLoan ? "loan_balance" : "generic_balance"}`);
    if (isLoan) {
      const domainTerm = "prestamo";
      // Rich loan balance scenarios — 7 scenarios covering full flow
      add(`Visualizar listado de ${domainTerm}s disponibles`,
        [`Validar que se muestre "Listado de ${domainTerm}s".`],
        [`El usuario tiene al menos un ${domainTerm} activo.`],
        `Listado de ${domainTerm}s visible.`);
      add(`Consultar detalle del primer ${domainTerm} visible`,
        [`Seleccionar el primer ${domainTerm} visible del listado.`],
        [`El usuario tiene ${domainTerm}s registrados.`],
        `Detalle del ${domainTerm} visible.`);
      add(`Validar datos identificativos del ${domainTerm}`,
        [`Seleccionar el primer ${domainTerm} visible del listado.`,
          `Validar que se muestre "Tipo de prestamo".`,
          `Validar que se muestre "Numero de prestamo".`,
          `Validar que se muestre "Fecha y hora de la consulta".`],
        [], `Datos identificativos del ${domainTerm} visibles.`);
      add(`Validar campos financieros del ${domainTerm}`,
        [`Seleccionar el primer ${domainTerm} visible del listado.`,
          `Validar que se muestre "Balance pendiente a la fecha".`,
          `Validar que se muestre "Tasa de interes".`,
          `Validar que se muestre "Monto desembolsado".`,
          `Validar que se muestre "Saldo de cancelacion".`],
        [], `Campos financieros del ${domainTerm} visibles.`);
      add(`Validar plan de pagos del ${domainTerm}`,
        [`Seleccionar el primer ${domainTerm} visible del listado.`,
          `Validar que se muestre "Numero de cuota".`,
          `Validar que se muestre "Plazo".`,
          `Validar que se muestre "Fecha ultimo pago".`,
          `Validar que se muestre "Monto ultimo pago".`,
          `Validar que se muestre "Fecha proxima cuota".`,
          `Validar que se muestre "Monto pagado".`],
        [], `Plan de pagos del ${domainTerm} visible.`);
      add(`Validar opciones posteriores en el detalle del ${domainTerm}`,
        [`Seleccionar el primer ${domainTerm} visible del listado.`,
          `Validar que el boton "Volver al listado de prestamos" este visible.`,
          `Validar que el boton "Volver al menu principal" este visible.`,
          `Validar que el boton "Enviar via correo" este visible.`,
          `Validar que el boton "Imprimir" este visible.`,
          `Validar que el boton "Generar tabla amortizacion" este visible.`],
        [], `Opciones posteriores del ${domainTerm} visibles.`);
      add(`Regresar al listado de ${domainTerm}s desde el detalle`,
        [`Clic en "Volver al listado de prestamos".`,
          `Validar que se muestre "Listado de ${domainTerm}s".`],
        [`El usuario esta en el detalle de un ${domainTerm}.`],
        `Regreso al listado de ${domainTerm}s exitoso.`);
    } else {
      const sel = required[0] || "el producto o cuenta";
      add("consultar balance", [`Seleccionar ${sel} a consultar.`, "Validar que se muestre el balance o detalle solicitado.", "Validar que el monto se muestre en formato correcto."], [], "El sistema muestra el balance o detalle correctamente.");
      add("finalizacion de consulta", [`Seleccionar ${sel} a consultar.`, "Validar balance o detalle.", "Volver al listado o pantalla anterior."], [], "El usuario consulta y regresa correctamente.");
    }

  } else if (huIntent === "transactional_document_flow" && (isBalance || isStatement)) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=balance_inquiry`);
    const sel = required[0] || "el producto o cuenta";
    add("consultar " + dType, [`Seleccionar ${sel} a consultar.`, "Validar que se muestre el balance o detalle solicitado.", "Validar que el monto se muestre en formato correcto."], [], "El sistema muestra el balance o detalle correctamente.");
    if (required.length > 0) add("validacion de seleccion", ["Intentar consultar sin seleccionar un producto o cuenta.", "Validar que se muestre una indicacion de seleccion requerida."], [], "El sistema solicita seleccionar un producto o cuenta.");
    add("finalizacion de consulta", [`Seleccionar ${sel} a consultar.`, "Validar balance o detalle.", "Volver al listado o pantalla anterior."], [], "El usuario consulta y regresa correctamente.");

  } else if (huIntent === "transactional_document_flow" && isPayment) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=payment_transfer`);
    const d = required.length > 0 ? required.map(r => `Completar ${r}.`) : ["Completar los datos requeridos."];
    add("operacion exitosa", [...d, "Revisar el resumen.", "Confirmar.", "Validar comprobante o resultado."], ["Los datos estan disponibles."], "Operacion completada exitosamente.");
    if (required.length > 0) add("validacion de campos", [`Intentar continuar sin completar ${required[0]}.`, "Validar mensaje de campo requerido."], [], "El sistema muestra validacion.");
    add("cancelacion", [...d, "Revisar resumen.", "Cancelar antes de confirmar.", "Validar que no se ejecute."], [], "Operacion cancelada.");

  } else if (huIntent === "transactional_document_flow" && isRegistration) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=product_request`);
    const d = required.length > 0 ? required.map(r => `Completar ${r}.`) : ["Completar los campos requeridos."];
    add("solicitud exitosa", [...d, "Revisar resumen.", "Confirmar.", "Validar confirmacion."], ["Datos disponibles."], "Solicitud completada.");
    add("validacion", ["Intentar enviar sin datos requeridos.", "Validar mensaje de campos obligatorios."], [], "Validacion mostrada.");
    add("cancelacion", ["Cancelar antes de completar.", "Validar que no se procese."], [], "Solicitud cancelada.");

  } else if (huIntent === "transactional_document_flow" && isMaintenance) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=crud_maintenance`);
    const d = required.length > 0 ? required.map(r => `Completar ${r}.`) : ["Completar datos."];
    add("actualizacion exitosa", [...d, "Confirmar.", "Validar confirmacion."], ["Datos disponibles."], "Actualizacion completada.");
    add("validacion", ["Intentar guardar sin datos requeridos.", "Validar mensaje."], [], "Validacion mostrada.");
    add("cancelar edicion", ["Modificar datos.", "Cancelar sin guardar.", "Validar que cambios no se apliquen."], [], "Cambios descartados.");

  } else if (huIntent === "transactional_document_flow") {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=document_generation`);
    add("generacion exitosa", [`Acceder a funcionalidad de ${dType}.`, ...dataStep, ...(entities.hasPreview ? [`Revisar vista previa de ${dType}.`] : []), ...(entities.hasConfirmation ? [`Confirmar generacion de ${dType}.`] : [`${entities.action || "Generar"} ${dType}.`]), `Validar que ${dType} se genere correctamente.`], ["App disponible."], `${dType} generado correctamente.`);
    add(required.length > 0 ? "validacion datos obligatorios" : "validacion general", required.length > 0 ? [`Acceder a ${dType}.`, `Intentar sin completar ${required[0]}.`, "Validar mensaje de campo requerido."] : [`Acceder a ${dType}.`, "Intentar sin datos.", "Validar mensaje."], [], "Validacion mostrada.");
    if (entities.hasConfirmation || entities.hasCancel) add("confirmacion / cancelacion", [`Acceder a ${dType}.`, ...dataStep, ...(entities.hasPreview ? [`Revisar vista previa.`] : []), entities.hasCancel ? "Cancelar." : "Confirmar.", entities.hasCancel ? "Validar que no se realice." : `Validar ${dType} generado.`], ["Datos disponibles."], entities.hasCancel ? "Operacion cancelada." : "Documento generado.");

  } else if (isCatalog) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=catalog_browse`);
    add("visualizar listado", ["Navegar al listado.", "Validar opciones disponibles.", "Validar informacion basica."], ["Catalogo disponible."], "Listado visible.");
    add("seleccionar opcion", ["Navegar al listado.", "Seleccionar una opcion.", "Validar informacion detallada."], [], "Detalle visible.");
    add("volver al listado", ["Navegar al listado.", "Seleccionar opcion.", "Volver al listado.", "Validar listado."], [], "Navegacion correcta.");

  } else if (huIntent === "product_detail_flow") {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=product_detail`);
    add("visualizar detalle", ["Seleccionar producto.", "Validar informacion detallada.", "Validar secciones."], ["Producto disponible."], "Detalle visible.");
    add("explorar secciones", ["Seleccionar producto.", "Validar secciones.", entities.hasCancel ? "Volver al listado." : "Cerrar detalle."].filter(Boolean), [], "Secciones exploradas.");

  } else {
    console.log(`[scenario-preview] routePendingBuilder fallbackGeneric reason=intent_not_specialized`);
    add("flujo exitoso", [`Acceder a ${dType}.`, ...(required.length > 0 ? [`Completar ${required.join(", ")}.`] : []), entities.action ? `${entities.action} ${dType}.` : "Ejecutar operacion.", "Validar resultado."], ["App disponible."], "Operacion completada.");
    add("validacion", ["Ejecutar sin datos requeridos.", "Validar mensaje."], [], "Validacion mostrada.");
    add("cancelacion", ["Cancelar antes de completar.", "Validar que no se realice."], [], "Operacion cancelada.");
  }

  console.log(`[scenario-preview] routePendingBuilder generated=${scenarios.length} quality=intent_specific_route_pending automationStatus=requires_route_discovery`);
  return scenarios;
}

/**
 * Rich HU scenario model extracted from acceptance criteria.
 * Universal — no hardcoded projects, HUs, modules or labels.
 */
type HuScenarioModel = {
  mainIntent: string;
  subIntent: string;
  featureName: string;
  primaryAction: string | null;
  uiObligations: string[];
  nonUiRequirements: string[];
  requiredScreens: string[];
  requiredFields: string[];
  selectableEntities: string[];
  multiSelectEntities: string[];
  visibleOptions: string[];
  visibleButtons: string[];
  visibleWarnings: string[];
  previewSignals: boolean;
  confirmationSignals: boolean;
  returnOrCancelSignals: boolean;
  deliverySignals: boolean;
  searchSignals: boolean;
  dropdownSignals: boolean;
  dataRequirements: string[];
  rawSignals: string[];
};

/**
 * Extract explicit menu route from HU text.
 * Detects breadcrumb-like patterns: A > B, A → B, A / B, etc.
 * Generic — no hardcoded apps, modules, or labels.
 */
function extractExplicitRoutePath(huText: string): string[] {
  const t = huText.normalize("NFC");
  const segments: string[] = [];

  // Breadcrumb patterns: "seleccionó en el menú: A > B", "ruta: A > B", etc.
  const prefixPatterns = [
    /seleccion[oó] en el men[uú]\s*[:：]/i,
    /ruta(?:\s+\w+)?\s*[:：]/i,
    /men[uú]\s*[:：]/i,
    /opci[oó]n\s*[:：]/i,
    /navegaci[oó]n\s*[:：]/i,
  ];

  let routeFragment = "";
  for (const p of prefixPatterns) {
    const m = t.match(new RegExp(p.source + "\\s*(.+?)(?:\\.\\s|\\n|\\.$|$)", "i"));
    if (m && m[1]) {
      routeFragment = m[1].trim();
      break;
    }
  }

  if (!routeFragment) return segments;

  // Clean trailing period
  routeFragment = routeFragment.replace(/[.。]\s*$/, "").trim();

  // Split on separators: >, →, /
  const rawSegments = routeFragment.split(/\s*(?:&gt;|>|→|\/)\s*/);

  for (const seg of rawSegments) {
    const cleaned = seg
      .replace(/["""]/g, '"')
      .replace(/^[""]/, "")
      .replace(/[""]$/, "")
      .replace(/\s+/, " ")
      .replace(/[.。]\s*$/, "")
      .trim();
    if (cleaned.length > 1 && !/^\d+$/.test(cleaned)) {
      segments.push(cleaned);
    }
  }

  if (segments.length > 0) {
    console.log(`[hu-route] explicitRoutePath extracted=${segments.length} source=hu_text path="${segments.join(" > ")}"`);
  }

  return segments;
}

/**
 * Extract a rich scenario model from any HU text.
 * Generic — detects UI obligations and non-UI requirements from acceptance criteria.
 * No hardcoded HUs, apps, modules or labels.
 */
function extractHuScenarioModel(huText: string): HuScenarioModel {
  const t = huText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Detect main intent (mutually exclusive, prioritized)
  // Loan balance signals: prestamo + balance/saldo or loan financial fields
  const isLoanBalance = /prestamo/.test(t) && (/balance|saldo/.test(t) || /monto|tasa|plazo|cuota|desembolsado/.test(t));
  const isDoc = /carta|certificacion|constancia|comprobante|documento/.test(t) && /generar|emitir|descargar/.test(t);
  const isStatement = /estado de cuenta|extracto|movimiento/.test(t);
  const isBalance = (/balance|saldo/.test(t) && /\b(cuenta|producto|tarjeta|prestamo|prestamos)\b/.test(t)) || isLoanBalance;
  const isPayment = /pagar|pago|transferir|transferencia|monto/.test(t);
  const isRequest = /solicitar|contratar|apertura|registrar/.test(t) && /\b(cuenta|tarjeta|producto|servicio)\b/.test(t);
  const isCrud = /editar|modificar|cambiar|actualizar|eliminar|desactivar/.test(t) && !t.includes("no podra ser modificada");
  const isCatalog = /listado|catalogo|productos?|categorias/.test(t);

  let mainIntent = "generic";
  if (isLoanBalance || isBalance) mainIntent = "balance_inquiry";
  else if (isDoc) mainIntent = "document_generation";
  else if (isStatement) mainIntent = "statement_generation";
  else if (isPayment) mainIntent = "payment_transfer";
  else if (isRequest) mainIntent = "product_request";
  else if (isCrud) mainIntent = "maintenance_crud";
  else if (isCatalog) mainIntent = "catalog_listing";

  // Sub-intent refinement
  let subIntent = "standard";
  if (/prestamo/.test(t) && (mainIntent === "balance_inquiry" || /balance|saldo/.test(t))) subIntent = "loan_balance";
  else if (/certificacion|certificado/.test(t)) subIntent = "certification";
  else if (/referencia/.test(t)) subIntent = "reference_letter";
  else if (/vista previa/.test(t)) subIntent = "with_preview";
  else if (/qr/.test(t)) subIntent = "with_qr";
  else if (/codigo de autenticacion/.test(t)) subIntent = "with_auth_code";

  // Feature name from HU document type or primary term
  const featureName = extractDocumentType(t) || "operacion";

  // Primary action verb
  const primaryAction = extractPrimaryAction(t);

  // UI obligations: screen requirements
  const requiredScreens: string[] = [];
  const requiredFields: string[] = [];
  const selectableEntities: string[] = [];
  const multiSelectEntities: string[] = [];
  const visibleOptions: string[] = [];
  const visibleButtons: string[] = [];
  const visibleWarnings: string[] = [];

  // Detect UI obligations from HU text patterns
  const uiObligations: string[] = [];

  // Screens
  if (/formulario|pantalla|modal|ventana/.test(t)) { requiredScreens.push("form_screen"); uiObligations.push("form_screen"); }
  if (/vista previa|preview/.test(t)) { requiredScreens.push("preview_screen"); uiObligations.push("preview_screen"); }
  if (/confirmacion|resumen/.test(t)) { requiredScreens.push("confirmation_screen"); uiObligations.push("confirmation_screen"); }
  if (/resultado|comprobante|descarga/.test(t)) { requiredScreens.push("result_screen"); uiObligations.push("result_screen"); }
  if (/listado|resultados/.test(t)) { requiredScreens.push("list_screen"); uiObligations.push("list_screen"); }
  if (/detalle/.test(t)) { requiredScreens.push("detail_screen"); uiObligations.push("detail_screen"); }

  // Fields
  if (/completar|ingresar|llenar|campos|datos\s+requeridos/.test(t)) { requiredFields.push("data_entry_fields"); uiObligations.push("data_entry"); }
  if (/destinatario/.test(t)) { requiredFields.push("recipient"); uiObligations.push("recipient_field"); }
  if (/rnc\b/.test(t)) { requiredFields.push("rnc"); uiObligations.push("rnc_field"); }
  if (/correo|email/.test(t)) { requiredFields.push("email"); uiObligations.push("email_field"); }
  if (/monto/.test(t)) { requiredFields.push("amount"); uiObligations.push("amount_field"); }
  if (/fecha/.test(t)) { requiredFields.push("date"); uiObligations.push("date_field"); }
  if (/moneda/.test(t)) { requiredFields.push("currency"); uiObligations.push("currency_field"); }
  if (/periodo|rango/.test(t)) { requiredFields.push("period_range"); uiObligations.push("period_field"); }
  if (/motivo/.test(t)) { requiredFields.push("reason"); uiObligations.push("reason_field"); }

  // Selectable entities
  if (/producto|productos/.test(t)) { selectableEntities.push("product"); uiObligations.push("product_selection"); }
  if (/cuenta|cuentas/.test(t)) { selectableEntities.push("account"); uiObligations.push("account_selection"); }
  if (/tarjeta|tarjetas/.test(t)) { selectableEntities.push("card"); uiObligations.push("card_selection"); }
  if (/prestamo|prestamos/.test(t)) { selectableEntities.push("loan"); uiObligations.push("loan_selection"); }
  if (/deposito/.test(t)) { selectableEntities.push("deposit"); uiObligations.push("deposit_selection"); }
  if (/(mas de un|multiples|varios)\s+(producto|cuenta|tarjeta|prestamo|deposito)/.test(t)) { multiSelectEntities.push("multiple"); uiObligations.push("multi_select"); }

  // Visible buttons / labels / warnings
  if (/\"(.+?)\"/g.test(t)) {
    const quoted = [...t.matchAll(/\"(.+?)\"/g)].map(m => m[1]).slice(0, 5);
    visibleOptions.push(...quoted);
    if (quoted.length > 0) uiObligations.push("quoted_labels_found");
  }
  if (/confirmar/.test(t)) { visibleButtons.push("Confirmar"); uiObligations.push("confirm_button"); }
  if (/continuar/.test(t)) { visibleButtons.push("Continuar"); uiObligations.push("continue_button"); }
  if (/cancelar/.test(t)) { visibleButtons.push("Cancelar"); uiObligations.push("cancel_button"); }
  if (/volver/.test(t)) { visibleButtons.push("Volver"); uiObligations.push("return_button"); }
  if (/solicitar/.test(t)) { visibleButtons.push("Solicitar"); uiObligations.push("request_button"); }
  if (/generar/.test(t)) { visibleButtons.push("Generar"); uiObligations.push("generate_button"); }
  if (/descargar/.test(t)) { visibleButtons.push("Descargar"); uiObligations.push("download_button"); }

  // Warnings
  if (/advertencia|alerta|mensaje|importante|no podra ser modificada|no podra ser cambiada/.test(t)) {
    visibleWarnings.push("irreversible_action_warning");
    uiObligations.push("warning_message");
  }
  if (/enmascarado|oculto|parcial/.test(t)) { visibleWarnings.push("masked_data"); uiObligations.push("masked_data_warning"); }

  // Flow signals
  const previewSignals = /vista previa/.test(t);
  const confirmationSignals = /confirmar/.test(t);
  const returnOrCancelSignals = /(volver|retornar|cancelar)/.test(t);
  const deliverySignals = /(enviar por correo|correo electronico|email)/.test(t);
  const searchSignals = /(buscar|busqueda|rnc)/.test(t);
  const dropdownSignals = /lista desplegable|seleccionar|opciones/.test(t);

  if (previewSignals) uiObligations.push("preview_flow");
  if (confirmationSignals) uiObligations.push("confirmation_flow");
  if (returnOrCancelSignals) uiObligations.push("return_or_cancel_flow");
  if (deliverySignals) uiObligations.push("delivery_flow");
  if (searchSignals) uiObligations.push("search_flow");
  if (dropdownSignals) uiObligations.push("dropdown_select");

  // Non-UI requirements (excluded from MCP steps)
  const nonUiRequirements: string[] = [];
  if (/b2000|core|backend/.test(t)) nonUiRequirements.push("backend_state");
  if (/base de datos|bd|db/.test(t)) nonUiRequirements.push("database_state");
  if (/auditori/.test(t)) nonUiRequirements.push("audit_trail");
  if (/calculo|calcular/.test(t)) nonUiRequirements.push("financial_calculation");
  if (/firma\s+(fisica|electronica|digital)/.test(t)) nonUiRequirements.push("physical_signature");
  if (/envio real|correo real/.test(t)) nonUiRequirements.push("real_email_send");
  if (/integracion/.test(t)) nonUiRequirements.push("internal_integration");

  // Data requirements
  const dataRequirements: string[] = [];
  if (selectableEntities.length > 0) dataRequirements.push("client_with_available_products");
  if (multiSelectEntities.length > 0) dataRequirements.push("client_with_multiple_products");
  if (/correo|email/.test(t)) dataRequirements.push("client_with_registered_email");
  if (/rnc/.test(t)) dataRequirements.push("entity_with_valid_rnc");
  if (/buscar|busqueda/.test(t)) dataRequirements.push("valid_search_data");
  if (dropdownSignals) dataRequirements.push("available_list_options");

  // Raw signals for debugging
  const rawSignals: string[] = [];
  if (isDoc) rawSignals.push("document_generation");
  if (previewSignals) rawSignals.push("preview");
  if (confirmationSignals) rawSignals.push("confirmation");
  if (returnOrCancelSignals) rawSignals.push("return_or_cancel");
  if (deliverySignals) rawSignals.push("delivery");
  if (searchSignals) rawSignals.push("search");

  return {
    mainIntent, subIntent, featureName, primaryAction,
    uiObligations, nonUiRequirements, requiredScreens, requiredFields,
    selectableEntities, multiSelectEntities, visibleOptions, visibleButtons,
    visibleWarnings, previewSignals, confirmationSignals, returnOrCancelSignals,
    deliverySignals, searchSignals, dropdownSignals,
    dataRequirements, rawSignals,
  };
}

function extractDocumentType(t: string): string | null {
  const docs: [RegExp, string][] = [
    [/(?:carta\s+de\s+referencia\s+bancaria|carta\s+de\s+referencia)/i, "carta de referencia bancaria"],
    [/(?:estado\s+de\s+cuenta|extracto)/i, "estado de cuenta"],
    [/carta/i, "carta"], [/certificacion|certificado/i, "certificacion"],
    [/constancia/i, "constancia"], [/comprobante/i, "comprobante"],
    [/documento/i, "documento"], [/reporte/i, "reporte"],
  ];
  for (const [p, l] of docs) { if (p.test(t)) return l; }
  return null;
}

function extractPrimaryAction(t: string): string | null {
  const acts: [RegExp, string][] = [
    [/(?:generar|emitir)\s+(?:una\s+)?(?:carta|certificacion|documento)/i, "Generar"],
    [/(?:descargar|exportar|imprimir)\s+(?:una\s+)?(?:carta|documento|reporte)/i, "Descargar"],
    [/(?:transferir|pagar|enviar)\s+(?:fondos|dinero|pago|monto)/i, "Transferir"],
    [/(?:registrar|crear|solicitar|contratar)\s+(?:una\s+)?(?:cuenta|tarjeta|producto)/i, "Solicitar"],
    [/(?:consultar|visualizar|ver)\s+(?:el\s+)?(?:saldo|estado|detalle)/i, "Consultar"],
  ];
  for (const [p, v] of acts) { if (p.test(t)) return v; }
  return null;
}

/**
 * Route Pending Scenario Plan
 * Defines how many and which scenario variants to generate based on HuScenarioModel.
 * Universal — no hardcoded HUs, modules, apps or labels.
 */
type RoutePendingScenarioPlan = {
  scenarioCountTarget: number;
  complexity: "simple" | "medium" | "rich";
  variants: string[];
  primaryVariant: string;
  requiresSelectionFlow: boolean;
  requiresMultiSelectionFlow: boolean;
  requiresInputFlow: boolean;
  requiresSearchFlow: boolean;
  requiresDropdownFlow: boolean;
  requiresPreviewFlow: boolean;
  requiresConfirmationFlow: boolean;
  requiresReturnOrCancelFlow: boolean;
  requiresDeliveryFlow: boolean;
  dataRequirements: string[];
  excludedNonUiRequirements: string[];
};

/**
 * Build a scenario plan from the HuScenarioModel.
 * Determines complexity, target count, and which variants to generate.
 * No hardcoded projects, HUs, modules, or labels.
 */
function buildRoutePendingScenarioPlan(huModel: HuScenarioModel): RoutePendingScenarioPlan {
  const m = huModel;

  // Calculate obligation score
  let score = m.uiObligations.length + m.requiredFields.length + m.selectableEntities.length
    + m.visibleButtons.length + m.visibleWarnings.length + m.visibleOptions.length;
  if (m.previewSignals) score += 2;
  if (m.deliverySignals) score += 2;
  if (m.searchSignals) score += 2;
  if (m.dropdownSignals) score += 1;
  if (m.confirmationSignals) score += 1;
  if (m.returnOrCancelSignals) score += 1;
  if (m.multiSelectEntities.length > 0) score += 1;

  const complexity: "simple" | "medium" | "rich" = score <= 5 ? "simple" : score <= 11 ? "medium" : "rich";

  // Build variant list — stable order
  const baseVariants: string[] = [];
  const addIf = (v: string, condition: boolean) => { if (condition) baseVariants.push(v); };

  addIf("happy_path", true);
  addIf("selection_flow", m.selectableEntities.length > 0);
  addIf("multi_selection_flow", m.multiSelectEntities.length > 0);
  addIf("required_fields_flow", m.requiredFields.length > 0);
  addIf("search_flow", m.searchSignals);
  addIf("dropdown_selection_flow", m.dropdownSignals || m.visibleOptions.length > 0);
  addIf("preview_review_flow", m.previewSignals);
  addIf("confirmation_flow", m.confirmationSignals);
  addIf("return_or_cancel_flow", m.returnOrCancelSignals);
  addIf("delivery_flow", m.deliverySignals);
  addIf("visible_warning_flow", m.visibleWarnings.length > 0);
  if (baseVariants.length <= 2) baseVariants.push("generic_validation_flow");

  // Determine target count
  const mustHave: string[] = ["happy_path"];
  if (m.requiredFields.length > 0) mustHave.push("required_fields_flow");
  if (m.selectableEntities.length > 0) mustHave.push("selection_flow");
  if (m.searchSignals) mustHave.push("search_flow");
  if (m.previewSignals) mustHave.push("preview_review_flow");
  if (m.deliverySignals) mustHave.push("delivery_flow");
  if (m.returnOrCancelSignals) {
    if (m.confirmationSignals) mustHave.push("confirmation_return_or_cancel_flow");
    else mustHave.push("return_or_cancel_flow");
  }
  if (m.visibleWarnings.length > 0 && !mustHave.includes("preview_review_flow")) {
    mustHave.push("visible_warning_flow");
  }

  const minCount = complexity === "simple" ? 2 : complexity === "medium" ? 4 : 5;
  const maxCount = complexity === "simple" ? 3 : complexity === "medium" ? 5 : 8;
  let target = Math.min(Math.max(baseVariants.length, minCount), maxCount);

  // Combine mustHave with baseVariants preserving order
  const variants: string[] = [];
  const allVariants = [...new Set([...mustHave, ...baseVariants])];
  for (const v of allVariants) {
    if (variants.length >= target) break;
    if (!variants.includes(v)) variants.push(v);
  }

  console.log(`[scenario-preview] huPlan debug target=${target} base=${baseVariants.length} mustHave=${mustHave.length < 5 ? mustHave.join(",") : mustHave.length + " variants"} final=${variants.join(",")}`);

  // Flags
  const requiresSelectionFlow = m.selectableEntities.length > 0;
  const requiresMultiSelectionFlow = m.multiSelectEntities.length > 0;
  const requiresInputFlow = m.requiredFields.length > 0 || m.deliverySignals;
  const requiresSearchFlow = m.searchSignals;
  const requiresDropdownFlow = m.dropdownSignals || m.visibleOptions.length > 0;
  const requiresPreviewFlow = m.previewSignals;
  const requiresConfirmationFlow = m.confirmationSignals;
  const requiresReturnOrCancelFlow = m.returnOrCancelSignals;
  const requiresDeliveryFlow = m.deliverySignals;

  // Data requirements
  const dataRequirements: string[] = [...m.dataRequirements];
  if (requiresSelectionFlow && !dataRequirements.includes("client_with_available_products")) dataRequirements.push("client_with_available_products");
  if (requiresMultiSelectionFlow && !dataRequirements.includes("client_with_multiple_products")) dataRequirements.push("client_with_multiple_products");
  if (requiresSearchFlow && !dataRequirements.includes("valid_search_data")) dataRequirements.push("valid_search_data");
  if (requiresDeliveryFlow && !dataRequirements.includes("client_with_registered_contact")) dataRequirements.push("client_with_registered_contact");
  if (requiresDropdownFlow && !dataRequirements.includes("available_list_options")) dataRequirements.push("available_list_options");

  return {
    scenarioCountTarget: target,
    complexity,
    variants,
    primaryVariant: variants[0] || "happy_path",
    requiresSelectionFlow,
    requiresMultiSelectionFlow,
    requiresInputFlow,
    requiresSearchFlow,
    requiresDropdownFlow,
    requiresPreviewFlow,
    requiresConfirmationFlow,
    requiresReturnOrCancelFlow,
    requiresDeliveryFlow,
    dataRequirements,
    excludedNonUiRequirements: [...m.nonUiRequirements],
  };
}

/**
 * Build route-pending scenarios from a scenario plan.
 * Generates one scenario per variant, up to scenarioCountTarget.
 * All scenarios are routePending (mcpExecutable=false, nonExecutableCriteria=requires_route_discovery).
 */
function buildPlanBasedScenarios(
  issue: any, huIntent: string, reasonCode: string,
  routeStatus: string, appSlug?: string, candidatePrefixSteps?: string[],
  huModel?: any, scenarioPlan?: any,
): any[] {
  const summary = issue.summary ?? "";
  const key = issue.key;
  const featureName = huModel?.featureName ?? summary ?? "operacion";
  const baseFields = {
    type: "functional", database: "", isConverted: 0,
    automationType: "ui_discovery", setupStrategy: "no_login",
    appSlug: appSlug ?? "unknown", targetAppSlug: appSlug ?? "unknown",
    routeProfile: "", dataRequirements: "", nonExecutableCriteria: "requires_route_discovery",
    mcpExecutable: false, generationSource: "fallback" as const,
  };

  function prefix(): string[] {
    const s: string[] = [];
    if (candidatePrefixSteps && candidatePrefixSteps.length > 0) s.push(...candidatePrefixSteps.map(t => `Clic en "${t}".`));
    return s;
  }

  // Helper: convert field name to MCP dataKey
  function toDataKey(field: string): string {
    const map: Record<string, string> = {
      destinatario: "destinatario_documento",
      rnc: "rnc_entidad",
      correo: "correo_contacto",
      email: "correo_contacto",
      monto: "monto_operacion",
      fecha: "fecha_operacion",
      periodo: "periodo_consulta",
      moneda: "moneda_operacion",
      motivo: "motivo_operacion",
      cuenta: "cuenta_origen",
      rango: "rango_fechas",
    };
    return map[field.toLowerCase()] ?? `${field.toLowerCase()}_dato`;
  }

  // Helper: normalize domain entity for MCP selection step
  function toSelectionEntity(entity: string): string {
    const map: Record<string, string> = {
      product: "producto",
      account: "cuenta",
      card: "tarjeta",
      loan: "prestamo",
      deposit: "deposito",
    };
    return map[entity.toLowerCase()] ?? entity;
  }

  // Helper: build field entry step
  function buildFieldStep(field: string): string {
    const key = toDataKey(field);
    return `Ingresar ${field} usando ${key}.`;
  }

  // Helper: build selection step with ordinal
  function buildSelectionStep(entity: string, ordinal: "primer" | "segundo" = "primer"): string {
    const e = toSelectionEntity(entity);
    const prefix = ordinal === "primer" ? "primer" : "segundo";
    const gender = e.endsWith("a") ? "la" : "el";
    return ordinal === "primer"
      ? `Seleccionar el primer ${e} visible del listado.`
      : `Seleccionar el segundo ${e} visible del listado.`;
  }
  function buildVariantScenarios(): any[] {
    const variants = scenarioPlan?.variants ?? ["happy_path"];
    const target = scenarioPlan?.scenarioCountTarget ?? Math.min(variants.length, 3);
    const result: any[] = [];
    const pfx = prefix();
    const m = huModel;

    // Only generate up to target variants
    const toGenerate = variants.slice(0, target);

    for (const v of toGenerate) {
      let steps: string[] = [...pfx];
      let titlePostfix = "";
      let expected = "La operacion se completa correctamente.";

      switch (v) {
        case "happy_path":
          titlePostfix = "flujo principal";
          if (m?.visibleButtons?.length) steps.push(`Clic en "${m.visibleButtons[0]}".`);
          else if (m?.primaryAction) steps.push(`${m.primaryAction} ${m?.featureName ?? ""}.`);
          if (m?.visibleWarnings?.length) steps.push(`Validar que se muestre "${m.visibleWarnings[0]}".`);
          if (m?.confirmationSignals || m?.visibleButtons?.includes("Confirmar")) steps.push('Clic en "Confirmar".');
          steps.push(`Validar que ${m?.featureName ?? "la operacion"} se complete correctamente.`);
          expected = `El flujo principal de ${featureName} se completa exitosamente.`;
          break;

        case "selection_flow":
          titlePostfix = `seleccion de ${toSelectionEntity(m?.selectableEntities?.[0] ?? "elemento")}`;
          steps.push(buildSelectionStep(m?.selectableEntities?.[0] ?? "elemento"));
          if (m?.visibleButtons?.includes("Continuar")) steps.push('Clic en "Continuar".');
          steps.push(`Validar que se muestre la confirmacion de seleccion.`);
          expected = `La seleccion de ${toSelectionEntity(m?.selectableEntities?.[0] ?? "elemento")} se completa correctamente.`;
          break;

        case "multi_selection_flow":
          titlePostfix = "seleccion multiple";
          steps.push(buildSelectionStep(m?.selectableEntities?.[0] ?? "elemento", "primer"));
          steps.push(buildSelectionStep(m?.selectableEntities?.[0] ?? "elemento", "segundo"));
          steps.push("Validar que ambos elementos esten seleccionados.");
          expected = "La seleccion multiple se completa correctamente.";
          break;

        case "required_fields_flow":
          titlePostfix = "validacion de campos obligatorios";
          if (m?.requiredFields?.length) {
            steps.push(buildFieldStep(m.requiredFields[0]));
            steps.push('Clic en "Continuar".');
            steps.push(`Validar que se muestre la validacion del campo ${m.requiredFields[0]}.`);
          } else {
            steps.push("Completar los campos requeridos.");
            steps.push('Clic en "Continuar".');
            steps.push("Validar que se muestren las validaciones de campos obligatorios.");
          }
          expected = "El sistema muestra las validaciones de campos requeridos.";
          break;

        case "search_flow":
          titlePostfix = "busqueda y seleccion";
          if (m?.requiredFields?.includes("rnc") || m?.requiredFields?.includes("RNC")) {
            steps.push(buildFieldStep("rnc"));
          } else if (m?.requiredFields?.includes("destinatario")) {
            steps.push(buildFieldStep("destinatario"));
          } else {
            steps.push("Ingresar el termino de busqueda en el campo de busqueda.");
          }
          if (m?.visibleOptions?.length) steps.push(`Validar que se muestre "${m.visibleOptions[0]}".`);
          else steps.push("Validar que se muestren los resultados de busqueda.");
          if (m?.selectableEntities?.length) steps.push(buildSelectionStep(m.selectableEntities[0]));
          else steps.push("Seleccionar la primera opcion visible del listado.");
          expected = "La busqueda muestra resultados y permite seleccionar.";
          break;

        case "dropdown_selection_flow":
          titlePostfix = "seleccion de opcion";
          if (m?.visibleOptions?.length) {
            steps.push(`Validar que se muestre "${m.visibleOptions[0]}".`);
            steps.push(`Clic en "${m.visibleOptions[0]}".`);
          } else {
            steps.push("Validar que la lista de opciones este visible.");
            steps.push("Seleccionar la primera opcion disponible de la lista.");
          }
          if (m?.visibleButtons?.includes("Continuar")) steps.push('Clic en "Continuar".');
          expected = "La seleccion de opcion se completa correctamente.";
          break;

        case "preview_review_flow":
          titlePostfix = "vista previa";
          steps.push('Validar que se muestre "Vista previa".');
          if (m?.visibleWarnings?.length) {
            for (const w of m.visibleWarnings) steps.push(`Validar que se muestre "${w}".`);
          }
          if (m?.visibleButtons?.includes("Volver")) steps.push('Clic en "Volver".');
          else if (m?.visibleButtons?.includes("Confirmar")) steps.push('Clic en "Confirmar".');
          expected = `La vista previa de ${featureName} se muestra correctamente.`;
          break;

        case "confirmation_flow":
          titlePostfix = "confirmacion";
          if (m?.visibleButtons?.includes("Confirmar")) steps.push('Clic en "Confirmar".');
          steps.push(`Validar que se muestre la confirmacion de ${featureName}.`);
          expected = `La confirmacion de ${featureName} se completa correctamente.`;
          break;

        case "confirmation_return_or_cancel_flow":
          titlePostfix = "confirmacion o cancelacion";
          if (m?.visibleButtons?.includes("Confirmar")) {
            steps.push('Clic en "Confirmar".');
            steps.push(`Validar que se muestre la confirmacion de ${featureName}.`);
          }
          if (m?.visibleButtons?.includes("Cancelar")) steps.push('Clic en "Cancelar".');
          else if (m?.visibleButtons?.includes("Volver")) steps.push('Clic en "Volver".');
          if (!m?.visibleButtons?.includes("Cancelar") && !m?.visibleButtons?.includes("Volver")) {
            steps.push("Cancelar la operacion.");
          }
          steps.push("Validar que la operacion no se ejecute.");
          expected = `La confirmacion se completa y el usuario puede cancelar o volver.`;
          break;

        case "return_or_cancel_flow":
          titlePostfix = "cancelacion o retorno";
          if (m?.visibleButtons?.includes("Cancelar")) steps.push('Clic en "Cancelar".');
          else if (m?.visibleButtons?.includes("Volver")) steps.push('Clic en "Volver".');
          steps.push("Validar que la operacion no se ejecute.");
          expected = "La operacion se cancela sin efectos secundarios.";
          break;

        case "delivery_flow":
          titlePostfix = "envio o notificacion";
          steps.push('Validar que se muestre "Correo electronico".');
          if (m?.visibleWarnings?.some((w: string) => w.includes("enmascar") || w.includes("ocult"))) {
            steps.push("Validar que se muestre el correo enmascarado.");
          }
          steps.push("Seleccionar la primera opcion de correo visible del listado.");
          if (m?.visibleButtons?.includes("Continuar")) steps.push('Validar que el boton "Continuar" este visible.');
          if (m?.visibleButtons?.includes("Cancelar")) steps.push('Validar que el boton "Cancelar" este visible.');
          expected = `El envio de ${featureName} se completa correctamente.`;
          break;

        case "visible_warning_flow":
          titlePostfix = "advertencia visible";
          if (m?.visibleWarnings?.length) {
            for (const w of m.visibleWarnings) steps.push(`Validar que se muestre "${w}".`);
          }
          if (m?.visibleButtons?.includes("Continuar")) steps.push('Clic en "Continuar".');
          else if (m?.visibleButtons?.includes("Aceptar")) steps.push('Clic en "Aceptar".');
          expected = "La advertencia se muestra correctamente.";
          break;

        default:
          titlePostfix = "validacion general";
          if (m?.visibleButtons?.length) steps.push(`Clic en "${m.visibleButtons[0]}".`);
          else if (m?.primaryAction) steps.push(`${m.primaryAction} ${m?.featureName ?? ""}.`);
          if (m?.visibleWarnings?.length) steps.push(`Validar que se muestre "${m.visibleWarnings[0]}".`);
          steps.push(`Validar que ${m?.featureName ?? "la operacion"} se complete correctamente.`);
          expected = "La operacion se completa correctamente.";
      }

      result.push({
        ...baseFields,
        sourceIssueKey: key,
        title: `${featureName} — ${titlePostfix}`,
        steps,
        preconditions: ["El usuario esta autenticado en la aplicacion.", "La aplicacion esta disponible y accesible."],
        expectedResult: expected,
      });
    }

    return result;
  }

  const scenarios = buildVariantScenarios();
  console.log(`[scenario-preview] routePendingBuilder planBased=true target=${scenarioPlan?.scenarioCountTarget ?? "?"} variants=${scenarioPlan?.variants?.length ?? "?"}`);
  console.log(`[scenario-preview] routePendingBuilder generated=${scenarios.length} quality=plan_based_route_pending automationStatus=requires_route_discovery`);
  return scenarios;
}
}