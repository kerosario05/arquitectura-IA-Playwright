import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AppConfig, FullConfig, LoginMode, MissingInputBehavior, TestDataAliasesMap, TestDataMap, AppRouteProfile } from "../types/env.types";

const SENSITIVE_KEY_HINTS = ["password", "secret", "token", "key", "pass"];

export type AppProfile = {
  appSlug: string;
  source: "cli" | "env" | "testrail_project" | "default";
  name?: string;
  baseUrl?: string;
  baseUrlHash?: string;
  projectId?: string | number;
  projectName?: string;
  createdAt: string;
  updatedAt: string;
};

export type AppProfileResolveOptions = {
  cliAppSlug?: string;
  envAppSlug?: string;
  testRailProjectId?: string | number;
  testRailBaseUrl?: string;
  testRailEmail?: string;
  testRailApiKey?: string;
  baseUrl?: string;
  appName?: string;
};

export type AppProfileResult = {
  profile: AppProfile;
  baseDir: string;
};

const APPS_ROOT = path.join("automations", "apps");
const APP_SUBDIRS = ["pages", "flows", "cases", "lib", "components"];
const FRAMEWORK_AUTH_FLOW_FILES = {
  flows: ["auth.flow.ts", "auth.flow.js", "auth.flow.helpers.ts"],
  pages: ["identification.page.ts", "phoneconfirmation.page.ts", "operationsmenu.page.ts", "productlist.page.ts"],
  components: ["otp.component.ts", "virtual-keyboard.component.ts"]
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeAppSlug(input?: string): string {
  if (!input || !input.trim()) return "default";

  const raw = input.trim();

  const sanitized = raw.replace(/\.\./g, "").replace(/[\\/]/g, "-");

  const normalized = normalizeText(sanitized)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized || normalized === "default") return "default";

  return normalized;
}

export async function resolveProjectNameFromTestRail(options: {
  projectId: string | number;
  baseUrl: string;
  email: string;
  apiKey: string;
}): Promise<string | null> {
  try {
    const baseApiUrl = `${options.baseUrl}/index.php?/api/v2`;
    const authHeader = `Basic ${Buffer.from(`${options.email}:${options.apiKey}`).toString("base64")}`;
    const response = await fetch(`${baseApiUrl}/get_project/${options.projectId}`, {
      headers: { Authorization: authHeader }
    });
    if (!response.ok) return null;
    const project = await response.json() as { name?: string };
    return project.name || null;
  } catch {
    return null;
  }
}

export async function resolveAppProfile(options: AppProfileResolveOptions): Promise<AppProfileResult> {
  const now = new Date().toISOString();
  let appSlug: string;
  let source: AppProfile["source"];
  let projectId: string | number | undefined;
  let projectName: string | undefined;

  if (options.cliAppSlug?.trim()) {
    appSlug = normalizeAppSlug(options.cliAppSlug);
    source = "cli";
  } else if (options.envAppSlug?.trim()) {
    appSlug = normalizeAppSlug(options.envAppSlug);
    source = "env";
  } else if (options.testRailProjectId) {
    const projectNameResolved = await resolveProjectNameFromTestRail({
      projectId: options.testRailProjectId,
      baseUrl: options.testRailBaseUrl || "",
      email: options.testRailEmail || "",
      apiKey: options.testRailApiKey || ""
    });
    if (projectNameResolved) {
      appSlug = normalizeAppSlug(projectNameResolved);
      source = "testrail_project";
      projectId = options.testRailProjectId;
      projectName = projectNameResolved;
    } else {
      appSlug = "default";
      source = "default";
    }
  } else {
    appSlug = "default";
    source = "default";
  }

  const baseDir = path.join(APPS_ROOT, appSlug);

  const profile: AppProfile = {
    appSlug,
    source,
    name: options.appName || projectName || undefined,
    baseUrl: options.baseUrl,
    baseUrlHash: options.baseUrl ? crypto.createHash("sha256").update(options.baseUrl).digest("hex").slice(0, 12) : undefined,
    projectId,
    projectName,
    createdAt: now,
    updatedAt: now
  };

  return { profile, baseDir };
}

export async function ensureAppStructure(baseDir: string): Promise<string[]> {
  const created: string[] = [];

  await fsp.mkdir(baseDir, { recursive: true });

  for (const subdir of APP_SUBDIRS) {
    const dirPath = path.join(baseDir, subdir);
    try {
      await fsp.access(dirPath);
    } catch {
      await fsp.mkdir(dirPath, { recursive: true });
      created.push(subdir);
    }
  }

  const defaultAppDir = path.resolve(__dirname, "../../automations/apps/default");

  for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.flows) {
    const targetPath = path.join(baseDir, "flows", fileName);
    const sourcePath = path.join(defaultAppDir, "flows", fileName);
    try {
      await fsp.access(targetPath);
    } catch {
      try {
        await fsp.copyFile(sourcePath, targetPath);
        created.push(`flows/${fileName}`);
      } catch {
        console.warn(`[ensureAppStructure] Missing framework flow file: ${sourcePath}`);
      }
    }
  }

  for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.pages) {
    const targetPath = path.join(baseDir, "pages", fileName);
    const sourcePath = path.join(defaultAppDir, "pages", fileName);
    try {
      await fsp.access(targetPath);
    } catch {
      try {
        await fsp.copyFile(sourcePath, targetPath);
        created.push(`pages/${fileName}`);
      } catch {
        console.warn(`[ensureAppStructure] Missing framework page file: ${sourcePath}`);
      }
    }
  }

  for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.components) {
    const targetPath = path.join(baseDir, "components", fileName);
    const sourcePath = path.join(defaultAppDir, "components", fileName);
    try {
      await fsp.access(targetPath);
    } catch {
      try {
        await fsp.copyFile(sourcePath, targetPath);
        created.push(`components/${fileName}`);
      } catch {
        console.warn(`[ensureAppStructure] Missing framework component file: ${sourcePath}`);
      }
    }
  }

  await registerFrameworkPageObjects(baseDir);

  return created;
}

async function registerFrameworkPageObjects(baseDir: string): Promise<void> {
  const normalizedBase = baseDir.replace(/\\/g, "/").toLowerCase();
  if (normalizedBase.includes(".tmp-test") || normalizedBase.includes("test-results") || normalizedBase.includes("tmpdir") || normalizedBase.includes(".artifacts/tmp")) {
    return;
  }

  const indexPath = path.join(baseDir, "page-objects.index.json");
  let registry: any;
  try {
    const raw = await fsp.readFile(indexPath, "utf-8");
    registry = JSON.parse(raw);
  } catch {
    registry = { version: "1.0", appSlug: path.basename(baseDir), pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
  }

  const appSlug = path.basename(baseDir);
  const frameworkPageObjects = [
    {
      id: "po_framework_productlistpage",
      className: "ProductListPage",
      filePath: `automations/apps/${appSlug}/pages/productlist.page.ts`,
      screenSignature: `screen:${appSlug}-product_list`,
      methods: [
        { name: "selectProduct", intent: "select_product", parameters: ["productName"], available: true, status: "active", sensitive: false, confidence: 1.0, source: "" }
      ],
      confidence: 1.0,
      status: "active",
      sourcePlanIds: [],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  for (const po of frameworkPageObjects) {
    const existing = registry.pageObjects.find((p: any) => p.className === po.className);
    if (!existing) {
      registry.pageObjects.push(po);
    }
  }

  registry.updatedAt = new Date().toISOString();
  await fsp.writeFile(indexPath, JSON.stringify(registry, null, 2), "utf-8");
}

export function validateAuthFlowDependencies(baseDir: string): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.flows) {
    const targetPath = path.join(baseDir, "flows", fileName);
    try {
      fs.accessSync(targetPath);
    } catch {
      missing.push(`flows/${fileName}`);
    }
  }

  for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.pages) {
    const targetPath = path.join(baseDir, "pages", fileName);
    try {
      fs.accessSync(targetPath);
    } catch {
      missing.push(`pages/${fileName}`);
    }
  }

  for (const fileName of FRAMEWORK_AUTH_FLOW_FILES.components) {
    const targetPath = path.join(baseDir, "components", fileName);
    try {
      fs.accessSync(targetPath);
    } catch {
      missing.push(`components/${fileName}`);
    }
  }

  return { valid: missing.length === 0, missing };
}

export function logAppProfile(profile: AppProfile, baseDir: string, ensured?: string[]): void {
  const ensuredStr = ensured ? ensured.join(", ") : "pages, flows, cases, lib";
  console.log(`[app-profile] appSlug=${profile.appSlug} source=${profile.source} baseDir=${baseDir}`);
  if (profile.source === "testrail_project" && profile.projectId) {
    console.log(`[app-profile] projectId=${profile.projectId} projectName="${profile.projectName || ""}"`);
  }
  console.log(`[app-profile] ensured structure: ${ensuredStr}`);
}

export type PromotedAppConfig = {
  appProfile: AppProfile;
  baseUrl: string;
  loginMode: LoginMode;
  testData: TestDataMap;
  testDataAliases: TestDataAliasesMap;
  testDataRefs: Record<string, string>;
  username?: string;
  password?: string;
  usernameRef?: string;
  passwordRef?: string;
  extraLoginFields?: Record<string, string>;
  missingInputBehavior: MissingInputBehavior;
  routeProfile?: AppRouteProfile;
  updatedAt: string;
};

export type AppAutomationPaths = {
  appDir: string;
  configPath: string;
  testDataRefsPath: string;
  indexPath: string;
  pageObjectsIndexPath: string;
  flowsIndexPath: string;
  pagesDir: string;
  componentsDir: string;
  flowsDir: string;
  casesDir: string;
  caseDir?: string;
  caseConfigPath?: string;
  caseAutomationPath?: string;
  caseEvidenceDir?: string;
  caseRunsDir?: string;
  plansDir: string;
  specsDir: string;
  evidenceDir: string;
  runsDir: string;
  planPath?: string;
  specPath?: string;
};

function inferNameFromBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.replace(/^www\./i, "");
    const parts = host.split(".").filter(Boolean);
    if (parts.length === 0) return undefined;
    const candidate = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return candidate ? candidate.replace(/[-_]+/g, " ") : undefined;
  } catch {
    return undefined;
  }
}

function deriveSlugFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return "default";
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.replace(/^www\./i, "");
    const parts = host.split(".").filter(Boolean);
    const candidate = parts.length >= 2 ? parts[parts.length - 2] : host;
    return normalizeAppSlug(candidate);
  } catch {
    return "default";
  }
}

export function deriveAppProfile(input: {
  appProfile?: string;
  appName?: string;
  baseUrl?: string;
  now?: string;
}): AppProfile {
  const now = input.now ?? new Date().toISOString();
  const slug = input.appProfile?.trim()
    ? normalizeAppSlug(input.appProfile)
    : input.appName?.trim()
      ? normalizeAppSlug(input.appName)
      : deriveSlugFromBaseUrl(input.baseUrl);

  const resolvedName = input.appName?.trim() || inferNameFromBaseUrl(input.baseUrl);
  return {
    appSlug: slug || "default",
    source: "default",
    name: resolvedName,
    baseUrl: input.baseUrl,
    baseUrlHash: input.baseUrl ? crypto.createHash("sha256").update(input.baseUrl).digest("hex").slice(0, 12) : undefined,
    createdAt: now,
    updatedAt: now
  };
}

export function getPromotedAppDirectory(appProfile: AppProfile, outputRoot?: string): string {
  return path.join(outputRoot ?? ".", "automations", "apps", appProfile.appSlug);
}

export function buildAppAutomationPaths(appProfile: AppProfile, automationId?: string, outputRoot?: string): AppAutomationPaths {
  const appDir = getPromotedAppDirectory(appProfile, outputRoot);
  const casesDir = path.join(appDir, "cases");
  const plansDir = path.join(appDir, "plans");
  const specsDir = path.join(appDir, "specs");
  const evidenceDir = path.join(appDir, "evidence");
  const runsDir = path.join(appDir, "runs");
  const pagesDir = path.join(appDir, "pages");
  const componentsDir = path.join(appDir, "components");
  const flowsDir = path.join(appDir, "flows");
  const caseDir = automationId ? path.join(casesDir, automationId) : undefined;
  return {
    appDir,
    configPath: path.join(appDir, "app.config.json"),
    testDataRefsPath: path.join(appDir, "test-data.refs.json"),
    indexPath: path.join(appDir, "index.json"),
    pageObjectsIndexPath: path.join(appDir, "page-objects.index.json"),
    flowsIndexPath: path.join(appDir, "flows.index.json"),
    pagesDir,
    componentsDir,
    flowsDir,
    casesDir,
    caseDir,
    caseConfigPath: caseDir ? path.join(caseDir, "case.json") : undefined,
    caseAutomationPath: caseDir ? path.join(caseDir, "automation.json") : undefined,
    caseEvidenceDir: caseDir ? path.join(caseDir, "evidence") : undefined,
    caseRunsDir: caseDir ? path.join(caseDir, "runs") : undefined,
    plansDir,
    specsDir,
    evidenceDir,
    runsDir,
    planPath: caseDir ? path.join(caseDir, "plan.json") : undefined,
    specPath: caseDir ? path.join(caseDir, "case.spec.ts") : undefined
  };
}

function buildTestDataRefs(testData: TestDataMap): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const key of Object.keys(testData)) {
    refs[key] = `APP_TEST_DATA_JSON.${key}`;
  }
  return refs;
}

function shouldPersistSensitiveValue(key: string): boolean {
  const normalized = normalizeText(key);
  return !SENSITIVE_KEY_HINTS.some((hint) => normalized.includes(hint));
}

function sanitizeExtraLoginFields(extraLoginFields?: Record<string, string>): Record<string, string> | undefined {
  if (!extraLoginFields) return undefined;
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(extraLoginFields)) {
    sanitized[key] = shouldPersistSensitiveValue(key) ? value : "__REDACTED__";
  }
  return sanitized;
}

export function serializeRuntimeConfigForPromotion(config: FullConfig, existingConfig?: PromotedAppConfig): PromotedAppConfig {
  const profile = deriveAppProfile({
    appProfile: config.app.appProfile,
    appName: config.app.name,
    baseUrl: config.app.baseUrl
  });

  return {
    appProfile: profile,
    baseUrl: config.app.baseUrl,
    loginMode: config.app.loginMode,
    testData: config.app.testData,
    testDataAliases: config.app.testDataAliases,
    testDataRefs: buildTestDataRefs(config.app.testData),
    username: config.app.username,
    password: config.app.password,
    usernameRef: config.app.username ? "APP_USERNAME" : undefined,
    passwordRef: config.app.password ? "APP_PASSWORD" : undefined,
    extraLoginFields: sanitizeExtraLoginFields(config.app.extraLoginFields),
    missingInputBehavior: config.app.missingInputBehavior,
    // Preserve routeProfile from existing config if available
    routeProfile: existingConfig?.routeProfile,
    updatedAt: new Date().toISOString()
  };
}

export function buildMergedConfig(appConfig: PromotedAppConfig, globalConfig: FullConfig): FullConfig {
  const mergedApp: AppConfig = {
    ...globalConfig.app,
    name: appConfig.appProfile.name ?? globalConfig.app.name,
    appProfile: appConfig.appProfile.appSlug,
    baseUrl: appConfig.baseUrl,
    loginMode: appConfig.loginMode,
    username: appConfig.username ?? globalConfig.app.username,
    password: appConfig.password ?? globalConfig.app.password,
    extraLoginFields: appConfig.extraLoginFields,
    testData: appConfig.testData,
    testDataAliases: appConfig.testDataAliases,
    missingInputBehavior: appConfig.missingInputBehavior
  };

  return {
    ...globalConfig,
    app: mergedApp
  };
}

export function loadPromotedAppConfigSync(options: { appSlug: string; configPath?: string }): PromotedAppConfig | undefined {
  const appProfile: AppProfile = {
    appSlug: normalizeAppSlug(options.appSlug),
    source: "default",
    createdAt: "",
    updatedAt: ""
  };
  const paths = buildAppAutomationPaths(appProfile);
  const configPath = options.configPath ?? paths.configPath;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as PromotedAppConfig;
  } catch {
    return undefined;
  }
}

export function loadRouteProfile(appSlug: string): AppRouteProfile | undefined {
  const config = loadPromotedAppConfigSync({ appSlug });
  
  // First try to load from app.config.json routeProfile
  if (config?.routeProfile) {
    const normalized = normalizeRouteProfileConfig(config, appSlug);
    if (normalized) {
      console.log(`[route-profile] loaded appSlug=${appSlug} source=app.config.json domainTerms=${normalized.domainTerms?.length ?? 0} routes=${normalized.routes?.length ?? 0}`);
      return normalized;
    }
  }
  
  // Fallback: check if config has flat routeProfile fields (domainTerms, routes, intermediates)
  const configWithRouteProfile = config as any;
  if (configWithRouteProfile?.domainTerms || configWithRouteProfile?.routes || configWithRouteProfile?.intermediates) {
    const normalized = normalizeRouteProfileConfig(configWithRouteProfile, appSlug);
    if (normalized) {
      console.log(`[route-profile] loaded appSlug=${appSlug} source=app.config.json.flat domainTerms=${normalized.domainTerms?.length ?? 0} routes=${normalized.routes?.length ?? 0}`);
      return normalized;
    }
  }
  
  // Last resort: load from pending suggestions if available
  // This allows route profile learning to work even before suggestions are applied
  console.log(`[route-profile] appSlug=${appSlug} no routeProfile in app.config.json, returning undefined`);
  return undefined;
}

/**
 * Normalize routeProfile from app.config.json to standard AppRouteProfile format.
 * 
 * Supports two formats:
 * 
 * A) app.config.json with routeProfile object:
 * {
 *   "appSlug": "kiosko",
 *   "routeProfile": {
 *     "name": "product_information",
 *     "entry": [],
 *   "aliases": {},
 *     "intermediates": {},
 *     "domainTerms": {}
 *   }
 * }
 * 
 * B) routeProfile standalone flat:
 * {
 *   "appSlug": "kiosko",
 *   "routeProfile": "product_information",
 *   "entry": [],
 *   "aliases": {},
 *   "intermediates": {},
 *   "domainTerms": {}
 * }
 */
export function normalizeRouteProfileConfig(config: PromotedAppConfig, appSlug?: string): AppRouteProfile | undefined {
  const routeProfile = config.routeProfile;
  if (!routeProfile) {
    return undefined;
  }
  
  // Format A: routeProfile is already an object
  if (typeof routeProfile === "object" && !Array.isArray(routeProfile)) {
    const normalized: AppRouteProfile = {
      entryPoints: (routeProfile as any).entry ?? (routeProfile as any).entryPoints ?? [],
      aliases: (routeProfile as any).aliases ?? {},
      domainTerms: normalizeDomainTerms((routeProfile as any).domainTerms),
      blockedLabels: (routeProfile as any).blockedLabels ?? [],
      submitLikeLabels: (routeProfile as any).submitLikeLabels ?? []
    };
    
    // Convert intermediates to routes if routes not present
    if ((routeProfile as any).routes) {
      normalized.routes = (routeProfile as any).routes;
    } else if ((routeProfile as any).intermediates) {
      normalized.routes = convertIntermediatesToRoutes((routeProfile as any).intermediates);
    }
    
    const source = "app_config_object";
    const loggedAppSlug = config.appProfile?.appSlug ?? appSlug ?? "unknown";
    console.log(`[route-profile] normalized appSlug=${loggedAppSlug} source=${source} domainTerms=${normalized.domainTerms?.length ?? 0} routes=${normalized.routes?.length ?? 0}`);
    
    return normalized;
  }
  
  // Format B: routeProfile is a string (standalone flat format)
  if (typeof routeProfile === "string") {
    const normalized: AppRouteProfile = {
      entryPoints: (config as any).entry ?? (config as any).entryPoints ?? [],
      aliases: (config as any).aliases ?? {},
      domainTerms: normalizeDomainTerms((config as any).domainTerms),
      blockedLabels: (config as any).blockedLabels ?? [],
      submitLikeLabels: (config as any).submitLikeLabels ?? []
    };
    
    // Convert intermediates to routes if routes not present
    if ((config as any).routes) {
      normalized.routes = (config as any).routes;
    } else if ((config as any).intermediates) {
      normalized.routes = convertIntermediatesToRoutes((config as any).intermediates);
    }
    
    const source = "standalone_flat";
    const loggedAppSlug = config.appProfile?.appSlug ?? appSlug ?? "unknown";
    console.log(`[route-profile] normalized appSlug=${loggedAppSlug} source=${source} domainTerms=${normalized.domainTerms?.length ?? 0} routes=${normalized.routes?.length ?? 0}`);
    
    return normalized;
  }
  
  return undefined;
}

/**
 * Normalize domainTerms from various formats to string array.
 * Supports: string[], Record<string, any>, or undefined
 */
function normalizeDomainTerms(domainTerms: any): string[] {
  if (!domainTerms) {
    return [];
  }
  
  if (Array.isArray(domainTerms)) {
    const unique = Array.from(new Set(domainTerms.filter(t => typeof t === "string")));
    return unique;
  }
  
  if (typeof domainTerms === "object") {
    // Record<string, any> - extract keys or values
    const entries = Object.entries(domainTerms);
    if (entries.length > 0) {
      // If values are strings, use values; otherwise use keys
      const firstValue = entries[0][1];
      let result: string[];
      if (typeof firstValue === "string") {
        result = Object.values(domainTerms).filter(v => typeof v === "string");
      } else {
        result = Object.keys(domainTerms);
      }
      // Deduplicate
      const unique = Array.from(new Set(result));
      return unique;
    }
  }
  
  return [];
}

/**
 * Convert intermediates object to routes array.
 * 
 * Input: { "Tarjetas": ["Tarjeta de Crédito", "Tarjeta de Débito"], ... }
 * Output: [{ from: "Tarjetas", intermediates: ["Tarjeta de Crédito", "Tarjeta de Débito"] }, ...]
 */
function convertIntermediatesToRoutes(intermediates: Record<string, string[]>): Array<{ from: string; intermediates: string[]; domain?: string }> {
  if (!intermediates || typeof intermediates !== "object") {
    return [];
  }
  
  return Object.entries(intermediates).map(([from, intermediatesList]) => ({
    from,
    intermediates: Array.isArray(intermediatesList) ? intermediatesList : [],
    domain: undefined
  }));
}

export async function savePromotedAppConfig(config: PromotedAppConfig, outputRoot?: string): Promise<void> {
  const paths = buildAppAutomationPaths(config.appProfile, undefined, outputRoot);
  await fsp.mkdir(paths.appDir, { recursive: true });
  await fsp.mkdir(paths.pagesDir, { recursive: true });
  await fsp.mkdir(paths.componentsDir, { recursive: true });
  await fsp.mkdir(paths.flowsDir, { recursive: true });
  await fsp.mkdir(paths.casesDir, { recursive: true });
  await fsp.mkdir(paths.plansDir, { recursive: true });
  await fsp.mkdir(paths.specsDir, { recursive: true });
  await fsp.mkdir(paths.evidenceDir, { recursive: true });
  await fsp.mkdir(paths.runsDir, { recursive: true });
  await fsp.writeFile(paths.configPath, JSON.stringify(config, null, 2), "utf-8");
  await fsp.writeFile(paths.testDataRefsPath, JSON.stringify(config.testDataRefs, null, 2), "utf-8");
}

export function redactPromotedAppConfigForLogs(config: PromotedAppConfig): Record<string, unknown> {
  return {
    appProfile: config.appProfile,
    baseUrl: config.baseUrl,
    loginMode: config.loginMode,
    testDataKeys: Object.keys(config.testData),
    testDataAliases: config.testDataAliases,
    usernameRef: config.usernameRef,
    passwordRef: config.passwordRef,
    hasUsername: Boolean(config.username),
    hasPassword: Boolean(config.password),
    missingInputBehavior: config.missingInputBehavior,
    updatedAt: config.updatedAt
  };
}
