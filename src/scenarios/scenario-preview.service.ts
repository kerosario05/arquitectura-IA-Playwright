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
import {
  classifyScenarioIntent,
  hasPrivateIntentConfiguration,
  logScenarioIntentClassification,
  type ScenarioIntentClassification,
} from "./scenario-intent-classifier";
import { buildDerivedExecutionContext } from "./route-profile-derived-context";
import { repairMissingIntermediates, logIntermediateRepair } from "./scenario-intermediate-repair";
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

type PrivateRouteConfig = {
  module?: string;
  path?: string[] | string;
  route?: string[] | string;
  steps?: string[] | string;
  actionControls?: string[];
  actions?: string[];
  allowedActions?: string[];
  controls?: string[];
  assertionTerms?: string[];
  assertions?: string[];
  validationTerms?: string[];
  signals?: string[];
};

/**
 * Extract navigation path from private route config (tolerant of multiple property names)
 */
function extractNavigationPath(route: PrivateRouteConfig): string[] {
  const path = route.path || route.route || route.steps;
  if (!path) return [];
  return Array.isArray(path) ? path : [path];
}

/**
 * Extract action controls from private route config (tolerant of multiple property names)
 * Only actions go to allowedExecutableClicks
 */
function extractActionControls(route: PrivateRouteConfig): string[] {
  const actions = route.actionControls || route.actions || route.allowedActions || route.controls || [];
  return Array.isArray(actions) ? actions : [actions];
}

/**
 * Extract assertion terms from private route config (tolerant of multiple property names)
 * Assertions are validation-only, do NOT go to allowedExecutableClicks
 */
function extractAssertionTerms(route: PrivateRouteConfig): string[] {
  const assertions = route.assertionTerms || route.assertions || route.validationTerms || [];
  return Array.isArray(assertions) ? assertions : [assertions];
}

/**
 * Normalize text for comparison (accents, case, whitespace)
 */
function normalizeForComparison(text?: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validate that private catalog configuration is complete
 */
type PrivateCatalogValidation = {
  valid: boolean;
  authProfileResolved: boolean;
  privateRouteResolved: boolean;
  missingActionControls: boolean;
  missingAssertionTerms: boolean;
};

function validatePrivateCatalogComplete(
  appConfig?: any,
  privateRoutes?: PrivateRouteConfig[]
): PrivateCatalogValidation {
  // 1. Check authProfile
  const authProfileResolved = Boolean(appConfig?.authProfile && Object.keys(appConfig.authProfile).length > 0);

  // 2. Check privateRoutes exists
  const privateRouteResolved = Boolean(privateRoutes && privateRoutes.length > 0);

  // 3. Check actionControls
  let missingActionControls = true;
  if (privateRoutes && privateRoutes.length > 0) {
    const firstRoute = privateRoutes[0];
    const routeActions = extractActionControls(firstRoute);
    if (routeActions.length > 0) {
      missingActionControls = false;
    }
  }
  // Fallback to app.config defaults
  if (missingActionControls && appConfig?.privateActionControls) {
    const fallback = appConfig.privateActionControls as string[] | string | undefined;
    const actions = Array.isArray(fallback) ? fallback : (fallback ? [fallback] : []);
    if (actions.length > 0) {
      missingActionControls = false;
    }
  }

  // 4. Check assertionTerms or visible detail signals
  let missingAssertionTerms = true;
  if (privateRoutes && privateRoutes.length > 0) {
    const firstRoute = privateRoutes[0];
    const routeAssertions = extractAssertionTerms(firstRoute);
    if (routeAssertions.length > 0) {
      missingAssertionTerms = false;
    }
  }
  // Fallback to app.config defaults or visible detail signals
  if (missingAssertionTerms && appConfig?.privateAssertionTerms) {
    const fallback = appConfig.privateAssertionTerms as string[] | string | undefined;
    const assertions = Array.isArray(fallback) ? fallback : (fallback ? [fallback] : []);
    if (assertions.length > 0) {
      missingAssertionTerms = false;
    }
  }
  // Also check visibleControls as detail signal fallback
  if (missingAssertionTerms && appConfig?.routeProfile?.visibleControls) {
    const visibleControls = appConfig.routeProfile.visibleControls as string[] | undefined;
    const detailPatterns = [/detalles?/i, /requisitos?/i, /beneficios?/i, /condiciones?/i, /informaci[oó]n/i];
    const hasDetailSignals = visibleControls?.some((control: string) =>
      detailPatterns.some(p => p.test(control))
    );
    if (hasDetailSignals) {
      missingAssertionTerms = false;
    }
  }

  const valid = authProfileResolved && privateRouteResolved && !missingActionControls && !missingAssertionTerms;

  return {
    valid,
    authProfileResolved,
    privateRouteResolved,
    missingActionControls,
    missingAssertionTerms,
  };
}


/**
 * Build route profile from private route configuration
 */
function buildPrivateRouteProfile(
  appSlug: string,
  privateRoutes: PrivateRouteConfig[] | undefined,
  appConfig?: any,
  issue?: { summary?: string; description?: string }
): { profile: McpRouteProfile | null; resolved: boolean; selectedRoute: PrivateRouteConfig | null } {
  if (!privateRoutes || privateRoutes.length === 0) {
    return { profile: null, resolved: false, selectedRoute: null };
  }

  // Select first matching private route (simple strategy for MVP)
  const selectedRoute = privateRoutes[0];
  const pathSegments = extractNavigationPath(selectedRoute);
  let actionControls = extractActionControls(selectedRoute);
  let assertionTerms = extractAssertionTerms(selectedRoute);

  // Apply fallbacks from app.config if empty
  if (actionControls.length === 0 && appConfig?.privateActionControls) {
    const fallback = appConfig.privateActionControls as string[] | string | undefined;
    actionControls = Array.isArray(fallback) ? fallback : (fallback ? [fallback] : []);
  }
  if (assertionTerms.length === 0 && appConfig?.privateAssertionTerms) {
    const fallback = appConfig.privateAssertionTerms as string[] | string | undefined;
    assertionTerms = Array.isArray(fallback) ? fallback : (fallback ? [fallback] : []);
  }

  // Build navigation path without duplicating module
  let navigationSegments: string[] = [];
  if (selectedRoute.module) {
    navigationSegments.push(selectedRoute.module);
  }
  // Avoid duplicating module if it's the first path segment (after normalization)
  const normalizedModule = normalizeForComparison(selectedRoute.module);
  for (const segment of pathSegments) {
    const normalizedSegment = normalizeForComparison(segment);
    if (normalizedSegment && normalizedSegment !== normalizedModule) {
      navigationSegments.push(segment);
    }
  }

  // Build intermediates from path segments (excluding module)
  const intermediates: Record<string, string[]> = {};
  if (pathSegments.length > 0) {
    intermediates["private_navigation"] = pathSegments;
  }

  // Build a minimal profile that will be validated properly by route-profile-derived-context
  // IMPORTANT: Only actionControls go to visibleControls (as executable clicks)
  // assertionTerms are NOT executable clicks, only validations
  const profile: any = {
    name: "private_from_app_config",
    source: "app_config.privateRoutes",
    entry: [],
    aliases: {},
    intermediates,
    targetPaths: {},  // Keep empty, actions go to visibleControls
    visibleControls: actionControls,  // Only actionControls as executable; assertions are validation-only
    domainTerms: {},
    representativeFixture: {},
    notes: [
      `built from privateRoute module=${selectedRoute.module}`,
      `actionControls=${actionControls.length} assertionTerms=${assertionTerms.length}`,
    ],
    requiresAuth: true,
  };

  const navigationRoute = navigationSegments.join(" → ");
  console.log(
    `[private-route] resolved=true route="${navigationRoute}" actionControls=${actionControls.length} assertionTerms=${assertionTerms.length}`
  );

  // Warn if actionControls is empty
  if (actionControls.length === 0) {
    console.log(
      `[private-route-profile] WARNING missing_action_controls route="${navigationRoute}"`
    );
  } else {
    console.log(
      `[private-route-profile] built navigationPath=${navigationSegments.length} actionControls=${actionControls.length} assertionTerms=${assertionTerms.length}`
    );
  }

  return { profile: profile as McpRouteProfile, resolved: true, selectedRoute };
}

function buildRouteProfileForPrompt(
  targetAppSlug: string,
  requestRouteProfile?: McpRouteProfile,
  jiraSummary?: string,
  jiraDescription?: string,
  testrailSectionName?: string,
  scenarioTitles?: string[],
  storyIntent?: ScenarioIntentClassification,
): { routeProfile: McpRouteProfile | null; source: string; entrySteps: EntryStepConfig[]; loginMode?: string } {
  console.log(`[route-profile] resolving routeProfile targetAppSlug=${targetAppSlug} requestRouteProfile=${requestRouteProfile?.name ?? "none"} intent=${storyIntent?.intent ?? "none"}`);

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

  // 2a. Check for private intent with privateRoutes
  if (storyIntent?.intent === "private/authenticated_transaction") {
    const privateRoutes = appConfig?.privateRoutes as PrivateRouteConfig[] | undefined;

    // Validate private catalog completeness
    const validation = validatePrivateCatalogComplete(appConfig, privateRoutes);

    console.log(
      `[private-catalog] status=${validation.valid ? "complete" : "missing_or_incomplete"} ` +
      `authProfileResolved=${validation.authProfileResolved} ` +
      `privateRouteResolved=${validation.privateRouteResolved} ` +
      `missingActionControls=${validation.missingActionControls} ` +
      `missingAssertionTerms=${validation.missingAssertionTerms}`
    );

    if (!validation.valid) {
      // Block generation with clear diagnostics
      console.log(
        `[private-catalog] actionRequired=run_authenticated_private_discovery`
      );
      console.log(
        `[scenario-routing] blocked=true reasonCode=private_catalog_required`
      );

      // Return null to indicate private route not ready
      return {
        routeProfile: null,
        source: "private_blocked",
        entrySteps: [],
        loginMode: appConfig?.loginMode as string | undefined
      };
    }

    // Private catalog is valid, proceed with building profile
    if (privateRoutes && privateRoutes.length > 0) {
      const { profile: privateProfile, resolved } = buildPrivateRouteProfile(
        targetAppSlug,
        privateRoutes,
        appConfig,
        { summary: jiraSummary, description: jiraDescription }
      );
      if (privateProfile) {
        console.log(`[scenario-routing] selectedRouteProfile=private_from_app_config intent=private/authenticated_transaction`);
        return {
          routeProfile: privateProfile,
          source: "app_config.privateRoutes",
          entrySteps: [],
          loginMode: appConfig?.loginMode as string | undefined,
        };
      }
    }
  }

  // 2b. Try public routeProfile from app.config
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
      console.log(`[scenario-routing] selectedRouteProfile=${(configRp as Record<string, unknown>).name ?? "unknown"}`);
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
    storyIntent?.intent === "public/product_information" &&
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
    console.log(`[scenario-routing] selectedRouteProfile=${(seed as Record<string, unknown>).name ?? "unknown"}`);
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

  const rawAppConfig = loadAppConfigSync(appInference.appSlug);

  const maxIssues = Number(process.env.SCENARIO_PREVIEW_MAX_ISSUES) || 5;
  if (issues.length > maxIssues) {
    console.log(`[scenarios:preview] limiting issues from ${issues.length} to ${maxIssues}`);
    issues.length = maxIssues;
  }

  // Gather jira context for routeProfile seeding
  const jiraSummary = issues.length > 0 ? issues[0].summary : undefined;
  const jiraDescription = issues.length > 0 ? issues[0].description : undefined;
  const routeProfileFromConfig = getRouteProfileFromConfig(rawAppConfig) as McpRouteProfile | null;
  const issueIntentClassifications = new Map(
    issues.map(issue => {
      const classification = classifyScenarioIntent({
        issue,
        appSlug: appInference.appSlug,
        appConfig: rawAppConfig as Record<string, unknown> | null,
        routeProfile: routeProfileFromConfig,
      });
      logScenarioIntentClassification({
        appSlug: appInference.appSlug,
        issue,
        classification,
      });
      return [issue.key, classification] as const;
    }),
  );
  const primaryIssueIntent = issues.length > 0 ? issueIntentClassifications.get(issues[0].key) : undefined;

  const hasRuntimePrivateEvidence = Boolean(req.scenarioRouteEvidence) || Boolean(req.privateDiscoveryArtifacts);
  const blockedByMissingConfig = primaryIssueIntent?.intent === "private/authenticated_transaction" && !hasPrivateIntentConfiguration(rawAppConfig as Record<string, unknown> | null) && !hasRuntimePrivateEvidence;
  console.log(`[scenario-preview:route-evidence-gate] hasRuntimePrivateEvidence=${hasRuntimePrivateEvidence} blocked=${blockedByMissingConfig} reason=${blockedByMissingConfig ? "missing_private_configuration" : "has_evidence"}`);

  if (blockedByMissingConfig) {
    const blockedReason =
      "private intent requires appProfile.authProfile and appProfile.privateRoutes; public catalog generation is blocked";
    console.log(
      `[scenario-intent] appSlug=${appInference.appSlug} issue=${issues[0]?.key ?? "unknown"} intent=${primaryIssueIntent.intent} ` +
        `requiresAuth=${primaryIssueIntent.requiresAuth} confidence=${primaryIssueIntent.confidence} source=${primaryIssueIntent.source} ` +
        `reason="missing_private_configuration"`,
    );
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
      summary: { generated: 0, valid: 0, invalid: 0, rejected: issues.length, blocked: issues.length },
      routeProfile: routeProfileFromConfig,
      scenarios: [],
      rejected: issues.map(issue => ({
        sourceIssueKey: issue.key,
        reason: blockedReason,
      })),
      blockedScenarios: issues.map(issue => ({
        sourceIssueKey: issue.key,
        title: issue.summary,
        status: "blocked" as const,
        reasonCode: "needs_route_profile" as const,
        reason: blockedReason,
        diagnostics: [
          {
            level: "error" as const,
            code: "needs_route_profile" as const,
            message: blockedReason,
            context: { intent: primaryIssueIntent.intent, requiresAuth: true },
          },
        ],
        appSlug: appInference.appSlug,
        appProfilePath: appProfileResult.appConfigPath,
        suggestedAction: "configure_private_routes_and_auth_profile",
      })),
      warnings: [blockedReason],
      catalogDiagnostics: {
        catalogUsed: false,
        discoveryRefreshed: false,
        discoveredProductCount: 0,
        representativeProductCount: 0,
        warnings: [blockedReason],
        fallbackReason: "private_intent_missing_configuration",
      },
    };
  }

  // Build initial routeProfile (before AI generation)
  const { routeProfile: initialRouteProfile, source: rpSource, entrySteps: initialEntrySteps, loginMode } = buildRouteProfileForPrompt(
    appInference.appSlug,
    undefined,
    jiraSummary,
    jiraDescription,
    req.testrailSectionName,
    undefined,
    primaryIssueIntent,
  );

  console.log(`[scenarios:preview] routeProfile source=${rpSource}`);
  console.log(`[scenarios:preview] routeProfileName=${initialRouteProfile?.name ?? "null"}`);
  console.log(`[scenarios:preview] routeProfileEntry=${JSON.stringify(initialRouteProfile?.entry ?? [])}`);

  // Check if private catalog is blocked
  if (rpSource === "private_blocked" && !hasRuntimePrivateEvidence) {
    const blockedReason =
      "private/authenticated_transaction intent requires complete authProfile, privateRoutes, actionControls, and assertionTerms configuration. Run authenticated discovery to configure privately accessible routes and controls.";
    console.log(
      `[scenarios:preview] private_catalog_blocked appSlug=${appInference.appSlug} intent=${primaryIssueIntent?.intent}`,
    );

    // Check if auto-discovery can be triggered
    const canAutoDiscoverPrivateCatalog =
      process.env.AI_CATALOG_AUTO_DISCOVER === "true" &&
      primaryIssueIntent?.requiresAuth === true;

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
      summary: { generated: 0, valid: 0, invalid: 0, rejected: issues.length, blocked: issues.length },
      routeProfile: null,
      scenarios: [],
      rejected: issues.map(issue => ({
        sourceIssueKey: issue.key,
        reason: blockedReason,
      })),
      blockedScenarios: issues.map(issue => ({
        sourceIssueKey: issue.key,
        title: issue.summary,
        status: "blocked" as const,
        reasonCode: "needs_route_profile" as const,
        reason: blockedReason,
        diagnostics: [
          {
            level: "error" as const,
            code: "needs_route_profile" as const,
            message: blockedReason,
            context: {
              intent: primaryIssueIntent?.intent,
              requiresAuth: true,
              reasonCode: "private_catalog_required",
              canAutoDiscoverPrivateCatalog,
              discoveryEndpoint: canAutoDiscoverPrivateCatalog ? "/api/discovery/private" : undefined,
            },
          },
        ],
        appSlug: appInference.appSlug,
        appProfilePath: appProfileResult.appConfigPath,
        suggestedAction: "run_authenticated_private_discovery",
      })),
      warnings: [blockedReason],
      catalogDiagnostics: {
        catalogUsed: false,
        discoveryRefreshed: false,
        discoveredProductCount: 0,
        representativeProductCount: 0,
        warnings: [blockedReason],
        fallbackReason: "private_catalog_incomplete",
      },
    };
  }
  const { ensureScenarioGenerationContext } = await import("./scenario-catalog-context");

  const requestedCatalogOptions = req.catalogOptions ?? {
    useDiscoveredCatalog: process.env.AI_CATALOG_AUTO_DISCOVER === "true",
    catalogMode: process.env.AI_CATALOG_MODE === "refresh" ? "refresh" : "existing",
    coverageMode: process.env.AI_CATALOG_COVERAGE_MODE as "representative" | "exhaustive" || "representative",
    maxProductsPerCategory: parseInt(process.env.AI_CATALOG_MAX_PER_CATEGORY || "2", 10),
  };
  const catalogOptions =
    primaryIssueIntent?.intent === "public/product_information"
      ? requestedCatalogOptions
      : {
          ...requestedCatalogOptions,
          useDiscoveredCatalog: false,
        };
  if (primaryIssueIntent?.intent !== "public/product_information") {
    console.log(
      `[scenario-intent] catalogStrategy=skip_public_catalog intent=${primaryIssueIntent?.intent ?? "ambiguous"} ` +
        `requiresAuth=${primaryIssueIntent?.requiresAuth ?? false}`,
    );
  }

  const { routeProfile: enrichedRouteProfile, diagnostics: catalogDiagnostics } = await ensureScenarioGenerationContext(
    appInference.appSlug,
    initialRouteProfile,
    catalogOptions,
    (loginMode || "no_login") as LoginMode,
    config
  );

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
      summary: { generated: 0, valid: 0, invalid: 0, rejected: 0, blocked: 0 },
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
  try {
  console.log(`[scenario-preview:route-evidence-input] privateArtifacts=${Boolean(req.privateDiscoveryArtifacts)} routeEvidence=${Boolean(req.scenarioRouteEvidence)}`);
  console.log(`[scenario-preview:route-profile-quality-gate] quality=missing hasRuntimePrivateEvidence=${hasRuntimePrivateEvidence} rejected=${hasRuntimePrivateEvidence ? false : true}`);

    generationResult = await generateScenariosWithAi(
      issues,
      effectiveAppSlug,
      testrailMeta,
      appInference.appSlug,
      appInference.appName,
      routeProfileForGeneration,
      initialEntrySteps,
      loginMode,
      undefined, // _testProvider
      req.privateDiscoveryArtifacts,
      req.scenarioRouteEvidence,
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

  // Generate deterministic seeds for coverage guarantee (both representative and exhaustive modes)
  // Seeds fill coverage gaps for aligned products/categories not covered by AI
  if (catalogOptions.useDiscoveredCatalog && routeProfileForGeneration) {
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

  const validated: ValidatedScenario[] = [];
  let validCount = 0;
  let invalidCount = 0;

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

  // Only validate and process automatable scenarios
  for (const sc of automatableScenarios) {
    const validation = validateScenario(sc, resolvedRouteProfile);
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
    `[scenarios:preview] generated ${rawScenarios.length} scenarios valid=${validCount} rejected=${rejected.length} blocked=${blockedScenarios.length}`,
  );

  // Log generation diagnostics if available
  if (generationResult.generationDiagnostics) {
    const diag = generationResult.generationDiagnostics;
    console.log(
      `[scenarios:diagnostics] mode=${diag.generationMode} ` +
      `aiCalled=${diag.aiCalled} aiFailed=${diag.aiFailed ?? false} ` +
      `aiGenerated=${diag.aiGenerated} finalValid=${diag.finalValid} ` +
      `finalRejected=${diag.finalRejected} finalBlocked=${diag.finalBlocked} ` +
      `fallbackUsed=${diag.fallbackUsed} fallbackReason=${diag.fallbackReason ?? "none"}`
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
      generated: rawScenarios.length,
      valid: validCount,
      invalid: invalidCount,
      rejected: rejected.length,
      blocked: blockedScenarios.length,
    },
    routeProfile: resolvedRouteProfile,
    scenarios: validated,
    rejected,
    blockedScenarios,
    warnings,
    catalogDiagnostics,
  };
}
