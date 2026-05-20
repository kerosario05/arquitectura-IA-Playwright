import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AppConfig, FullConfig, LoginMode, MissingInputBehavior, TestDataAliasesMap, TestDataMap } from "../types/env.types";

const SENSITIVE_KEY_HINTS = ["password", "secret", "token", "key", "pass"];

export type AppProfile = {
  appSlug: string;
  name?: string;
  baseUrl?: string;
  baseUrlHash?: string;
  createdAt: string;
  updatedAt: string;
};

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
  updatedAt: string;
};

export type AppAutomationPaths = {
  appDir: string;
  configPath: string;
  testDataRefsPath: string;
  indexPath: string;
  plansDir: string;
  specsDir: string;
  evidenceDir: string;
  runsDir: string;
  planPath?: string;
  specPath?: string;
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeAppSlug(value: string): string {
  const normalized = normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "default";
}

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

function hashBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  return crypto.createHash("sha256").update(baseUrl).digest("hex").slice(0, 12);
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
    name: resolvedName,
    baseUrl: input.baseUrl,
    baseUrlHash: hashBaseUrl(input.baseUrl),
    createdAt: now,
    updatedAt: now
  };
}

export function getPromotedAppDirectory(appProfile: AppProfile, outputRoot?: string): string {
  return path.join(outputRoot ?? ".", "automations", "apps", appProfile.appSlug);
}

export function buildAppAutomationPaths(appProfile: AppProfile, automationId?: string, outputRoot?: string): AppAutomationPaths {
  const appDir = getPromotedAppDirectory(appProfile, outputRoot);
  const plansDir = path.join(appDir, "plans");
  const specsDir = path.join(appDir, "specs");
  const evidenceDir = path.join(appDir, "evidence");
  const runsDir = path.join(appDir, "runs");
  return {
    appDir,
    configPath: path.join(appDir, "app.config.json"),
    testDataRefsPath: path.join(appDir, "test-data.refs.json"),
    indexPath: path.join(appDir, "index.json"),
    plansDir,
    specsDir,
    evidenceDir,
    runsDir,
    planPath: automationId ? path.join(plansDir, `${automationId}.plan.json`) : undefined,
    specPath: automationId ? path.join(specsDir, `${automationId}.spec.ts`) : undefined
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

export function serializeRuntimeConfigForPromotion(config: FullConfig): PromotedAppConfig {
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

export async function savePromotedAppConfig(config: PromotedAppConfig): Promise<void> {
  const paths = buildAppAutomationPaths(config.appProfile);
  await fsp.mkdir(paths.appDir, { recursive: true });
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
