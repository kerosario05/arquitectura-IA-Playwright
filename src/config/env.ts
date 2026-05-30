import dotenv from "dotenv";
import type {
  BrowserName,
  FullConfig,
  LoginMode,
  MissingInputBehavior,
  RequiredTestRailRuntimeConfig,
  TestDataAliasesMap,
  TestDataMap,
  TestDataValue
} from "../types/env.types";
import type { RequiredJiraRuntimeConfig } from "../types/jira.types";

dotenv.config();

const allowedBrowsers: BrowserName[] = ["chromium", "firefox", "webkit"];
const allowedLoginModes: LoginMode[] = ["password", "no_login", "manual"];
const allowedMissingInputBehaviors: MissingInputBehavior[] = ["fail", "prompt", "skip", "auto_generate"];
const allowedTestDataProfiles: Array<"demo" | "qa" | "staging" | "production_like"> = ["demo", "qa", "staging", "production_like"];

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBoolean(value: string, name: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized !== "true" && normalized !== "false") {
    throw new Error(`Invalid boolean value for ${name}. Expected true or false.`);
  }
  return normalized === "true";
}

function parseBrowser(value: string): BrowserName {
  if (!allowedBrowsers.includes(value as BrowserName)) {
    throw new Error(`Invalid BROWSER value: ${value}. Allowed values: ${allowedBrowsers.join(", ")}`);
  }
  return value as BrowserName;
}

function parseLoginMode(value: string): LoginMode {
  if (!allowedLoginModes.includes(value as LoginMode)) {
    throw new Error(
      `Invalid APP_LOGIN_MODE value: ${value}. Allowed values: ${allowedLoginModes.join(", ")}`
    );
  }
  return value as LoginMode;
}

function parseNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric value for ${name}. Expected a positive number.`);
  }
  return parsed;
}

function parseOptionalPositiveNumber(rawValue: string | undefined, name: string): number | undefined {
  if (!rawValue || !rawValue.trim()) {
    return undefined;
  }
  return parseNumber(rawValue, name);
}

function parseOptionalThreshold(rawValue: string | undefined, name: string): number | undefined {
  if (!rawValue || !rawValue.trim()) {
    return undefined;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid numeric value for ${name}. Expected a number between 0 and 1.`);
  }

  return parsed;
}

function parseAgentProvider(rawValue?: string): "codex" | "copilot" | "custom" | "none" | undefined {
  if (!rawValue || !rawValue.trim()) {
    return undefined;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "codex" || normalized === "copilot" || normalized === "custom" || normalized === "none") {
    return normalized;
  }

  throw new Error("Invalid AGENT_PROVIDER value. Allowed values: codex, copilot, custom, none.");
}

function parseOptionalString(rawValue: string | undefined): string | undefined {
  const trimmed = rawValue?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePromotedRuntimeConfig(): {
  staleLoadingMs: number;
  maxLoadingMs: number;
  allowSafeForceClick: boolean;
  keepAliveDuringLoading: boolean;
  keepAliveIntervalMs: number;
} {
  return {
    staleLoadingMs: parseOptionalPositiveNumber(process.env.PROMOTED_RUNTIME_STALE_LOADING_MS, "PROMOTED_RUNTIME_STALE_LOADING_MS") ?? 12000,
    maxLoadingMs: parseOptionalPositiveNumber(process.env.PROMOTED_RUNTIME_MAX_LOADING_MS, "PROMOTED_RUNTIME_MAX_LOADING_MS") ?? 45000,
    allowSafeForceClick: process.env.PROMOTED_RUNTIME_ALLOW_SAFE_FORCE_CLICK?.toLowerCase() !== 'false',
    keepAliveDuringLoading: process.env.PROMOTED_RUNTIME_KEEP_ALIVE_DURING_LOADING?.toLowerCase() === 'true',
    keepAliveIntervalMs: parseOptionalPositiveNumber(process.env.PROMOTED_RUNTIME_KEEP_ALIVE_INTERVAL_MS, "PROMOTED_RUNTIME_KEEP_ALIVE_INTERVAL_MS") ?? 5000,
  };
}

function parseExpectedResultMode(rawValue?: string): "context" | "assertions" | "smart" {
  if (!rawValue || !rawValue.trim()) {
    return "context"; // Default to context mode
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "context" || normalized === "assertions" || normalized === "smart") {
    return normalized;
  }
  console.warn(`Invalid DISCOVERY_EXPECTED_RESULT_MODE value: "${rawValue}". Using default "context".`);
  return "context";
}

function parseExtraLoginFields(rawValue?: string): Record<string, string> | undefined {
  if (!rawValue || !rawValue.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error("Invalid APP_EXTRA_LOGIN_FIELDS_JSON. Expected valid JSON object.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid APP_EXTRA_LOGIN_FIELDS_JSON. Expected a flat JSON object.");
  }

  const entries = Object.entries(parsed);
  const result: Record<string, string> = {};

  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      throw new Error("Invalid APP_EXTRA_LOGIN_FIELDS_JSON. All values must be strings.");
    }
    result[key] = value;
  }

  return result;
}

function parseFlatJsonObject(rawValue: string, envName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`Invalid ${envName}. Expected valid JSON object.`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid ${envName}. Expected a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function parseTestData(rawValue?: string): TestDataMap {
  if (!rawValue || !rawValue.trim()) {
    return {};
  }

  const parsed = parseFlatJsonObject(rawValue, "APP_TEST_DATA_JSON");
  const result: TestDataMap = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof subValue === "string" || typeof subValue === "number" || typeof subValue === "boolean") {
          result[`${key}.${subKey}`] = subValue as TestDataValue;
        }
      }
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    result[key] = value as TestDataValue;
  }

  return result;
}

export function parseRawTestData(rawValue?: string): Record<string, unknown> {
  if (!rawValue || !rawValue.trim()) {
    return {};
  }
  return parseFlatJsonObject(rawValue, "APP_TEST_DATA_JSON");
}

function parseTestDataAliases(rawValue?: string): TestDataAliasesMap {
  if (!rawValue || !rawValue.trim()) {
    return {};
  }

  const parsed = parseFlatJsonObject(rawValue, "APP_TEST_DATA_ALIASES_JSON");
  const result: TestDataAliasesMap = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      result[key] = value;
    } else if (typeof value === "string") {
      result[key] = [value];
    } else {
      throw new Error("Invalid APP_TEST_DATA_ALIASES_JSON. Every value must be an array of strings or a single string.");
    }
  }

  return result;
}

export function normalizeAppProfile(rawValue?: string): string {
  if (!rawValue || !rawValue.trim()) return "default";
  return rawValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "default";
}

export function parseMissingInputBehavior(rawValue?: string): MissingInputBehavior {
  const trimmed = rawValue?.trim();
  const value = (!trimmed ? "fail" : trimmed).toLowerCase();
  if (!allowedMissingInputBehaviors.includes(value as MissingInputBehavior)) {
    throw new Error(
      `Invalid MISSING_INPUT_BEHAVIOR value: ${rawValue}. Allowed values: ${allowedMissingInputBehaviors.join(
        ", "
      )}`
    );
  }
  return value as MissingInputBehavior;
}

export function parseAutoGenerateTestData(rawValue?: string): boolean {
  const trimmed = rawValue?.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid AUTO_GENERATE_TEST_DATA value: ${rawValue}. Expected true or false.`);
}

export function parseAutoGenerateSensitiveData(rawValue?: string): boolean {
  const trimmed = rawValue?.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid AUTO_GENERATE_SENSITIVE_DATA value: ${rawValue}. Expected true or false.`);
}

export function parseTestDataProfile(rawValue?: string): "demo" | "qa" | "staging" | "production_like" {
  const trimmed = rawValue?.trim();
  if (!trimmed) return "qa";
  const normalized = trimmed.toLowerCase();
  if (!allowedTestDataProfiles.includes(normalized as any)) {
    throw new Error(`Invalid APP_TEST_DATA_PROFILE value: ${rawValue}. Allowed values: ${allowedTestDataProfiles.join(", ")}`);
  }
  return normalized as "demo" | "qa" | "staging" | "production_like";
}

export function parseAutoSelectSafeDefaults(rawValue?: string): boolean {
  const trimmed = rawValue?.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid AUTO_SELECT_SAFE_DEFAULTS value: ${rawValue}. Expected true or false.`);
}

export function parseAutoAcceptSafeCheckboxes(rawValue?: string): boolean {
  const trimmed = rawValue?.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid AUTO_ACCEPT_SAFE_CHECKBOXES value: ${rawValue}. Expected true or false.`);
}

function getAppBaseUrl(): string {
  const baseUrl = process.env.BASE_URL?.trim() || process.env.APP_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("Missing required environment variable: BASE_URL or APP_BASE_URL");
  }
  return baseUrl;
}

const appBaseUrl = getAppBaseUrl();

const appLoginMode = parseLoginMode(getRequiredEnv("APP_LOGIN_MODE"));
const headless = parseBoolean(getRequiredEnv("HEADLESS"), "HEADLESS");
const browser = parseBrowser(getRequiredEnv("BROWSER"));
const evidenceDir = getRequiredEnv("EVIDENCE_DIR");
const defaultTimeoutMs = parseNumber(getRequiredEnv("DEFAULT_TIMEOUT_MS"), "DEFAULT_TIMEOUT_MS");
const promotedSpecTimeoutMs = parseOptionalPositiveNumber(
  process.env.PROMOTED_SPEC_TIMEOUT_MS,
  "PROMOTED_SPEC_TIMEOUT_MS"
) ?? 120000;

const promotedRuntimeConfig = parsePromotedRuntimeConfig();


export const config: FullConfig = {
  app: {
    name: process.env.APP_NAME?.trim() || undefined,
    baseUrl: appBaseUrl,
    loginMode: appLoginMode,
    username: process.env.APP_USERNAME?.trim() || undefined,
    password: process.env.APP_PASSWORD?.trim() || undefined,
    extraLoginFields: parseExtraLoginFields(process.env.APP_EXTRA_LOGIN_FIELDS_JSON),
    testData: parseTestData(process.env.APP_TEST_DATA_JSON),
    rawTestData: parseRawTestData(process.env.APP_TEST_DATA_JSON),
    testDataAliases: parseTestDataAliases(process.env.APP_TEST_DATA_ALIASES_JSON),
    missingInputBehavior: parseMissingInputBehavior(process.env.MISSING_INPUT_BEHAVIOR),
    appProfile: normalizeAppProfile(process.env.APP_PROFILE),
    autoGenerateTestData: parseAutoGenerateTestData(process.env.AUTO_GENERATE_TEST_DATA),
    autoGenerateSensitiveData: parseAutoGenerateSensitiveData(process.env.AUTO_GENERATE_SENSITIVE_DATA),
    testDataProfile: parseTestDataProfile(process.env.APP_TEST_DATA_PROFILE),
    autoSelectSafeDefaults: parseAutoSelectSafeDefaults(process.env.AUTO_SELECT_SAFE_DEFAULTS),
    autoAcceptSafeCheckboxes: parseAutoAcceptSafeCheckboxes(process.env.AUTO_ACCEPT_SAFE_CHECKBOXES)
  },
  execution: {
    browser,
    headless,
    evidenceDir,
    defaultTimeoutMs,
    promotedSpecTimeoutMs,
    ...promotedRuntimeConfig
  },
  integrations: {
    testRail: {
      url: process.env.TESTRAIL_URL?.trim() || undefined,
      email: process.env.TESTRAIL_EMAIL?.trim() || undefined,
      apiKey: process.env.TESTRAIL_API_KEY?.trim() || undefined,
      projectId: process.env.TESTRAIL_PROJECT_ID?.trim() || undefined,
      suiteId: process.env.TESTRAIL_SUITE_ID?.trim() || undefined,
      sectionId: process.env.TESTRAIL_SECTION_ID?.trim() || undefined,
      sessionId: process.env.TESTRAIL_SESSION_ID?.trim() || undefined
    },
    jira: {
      baseUrl: process.env.JIRA_BASE_URL?.trim() || undefined,
      email: process.env.JIRA_EMAIL?.trim() || undefined,
      apiToken: process.env.JIRA_API_TOKEN?.trim() || undefined,
      projectKey: process.env.JIRA_PROJECT_KEY?.trim() || undefined,
      acceptanceCriteriaField: process.env.JIRA_ACCEPTANCE_CRITERIA_FIELD?.trim() || undefined,
      defaultJql: process.env.JIRA_JQL?.trim() || undefined,
      dryRun: (process.env.JIRA_DRY_RUN ?? "false").toLowerCase() === "true"
    },
    ai: {
      provider: process.env.AI_PROVIDER?.trim() || undefined,
      agentProvider: parseAgentProvider(process.env.AGENT_PROVIDER),
      model: process.env.AI_MODEL?.trim() || undefined,
      discoveryMode: (process.env.DISCOVERY_MODE ?? "false").toLowerCase() === "true",
      autoApproveDiscoveredObjects:
        (process.env.AUTO_APPROVE_DISCOVERED_OBJECTS ?? "false").toLowerCase() === "true",
      discoveryEnabled: (process.env.AI_DISCOVERY_ENABLED ?? "false").toLowerCase() === "true",
      discoveryConfidenceThreshold:
        parseOptionalThreshold(
          process.env.AI_DISCOVERY_CONFIDENCE_THRESHOLD,
          "AI_DISCOVERY_CONFIDENCE_THRESHOLD"
        ) ?? 0.85,
      discoveryRequireApprovalThreshold:
        parseOptionalThreshold(
          process.env.AI_DISCOVERY_REQUIRE_APPROVAL_THRESHOLD,
          "AI_DISCOVERY_REQUIRE_APPROVAL_THRESHOLD"
        ) ?? 0.7,
      discoveryMaxAttempts: parseOptionalPositiveNumber(
        process.env.AI_DISCOVERY_MAX_ATTEMPTS,
        "AI_DISCOVERY_MAX_ATTEMPTS"
      ) ?? 3,
      expectedResultMode: parseExpectedResultMode(process.env.DISCOVERY_EXPECTED_RESULT_MODE),
      routeCompletion: {
        enabled: (process.env.AI_ROUTE_COMPLETION_ENABLED ?? "false").toLowerCase() === "true",
        minConfidence: parseOptionalThreshold(
          process.env.AI_ROUTE_COMPLETION_MIN_CONFIDENCE,
          "AI_ROUTE_COMPLETION_MIN_CONFIDENCE"
        ) ?? 0.75,
        maxInsertedSteps: parseOptionalPositiveNumber(
          process.env.AI_ROUTE_COMPLETION_MAX_INSERTED_STEPS,
          "AI_ROUTE_COMPLETION_MAX_INSERTED_STEPS"
        ) ?? 1,
        useAppProfile: (process.env.AI_ROUTE_COMPLETION_USE_APP_PROFILE ?? "true").toLowerCase() === "true",
        allowGeneric: (process.env.AI_ROUTE_COMPLETION_ALLOW_GENERIC ?? "true").toLowerCase() === "true"
      },
      routeProfileLearning: {
        enabled: (process.env.ROUTE_PROFILE_LEARNING_ENABLED ?? "false").toLowerCase() === "true",
        autoApproveThreshold: parseOptionalThreshold(
          process.env.ROUTE_PROFILE_LEARNING_AUTO_APPROVE_THRESHOLD,
          "ROUTE_PROFILE_LEARNING_AUTO_APPROVE_THRESHOLD"
        ) ?? 0.90,
        autoApply: (process.env.ROUTE_PROFILE_LEARNING_AUTO_APPLY ?? "false").toLowerCase() === "true",
        minOccurrences: parseOptionalPositiveNumber(
          process.env.ROUTE_PROFILE_LEARNING_MIN_OCCURRENCES,
          "ROUTE_PROFILE_LEARNING_MIN_OCCURRENCES"
        ) ?? 1,
        blockSensitive: (process.env.ROUTE_PROFILE_LEARNING_BLOCK_SENSITIVE ?? "true").toLowerCase() === "true"
      }
    },
    agent: {
      provider: parseAgentProvider(process.env.AGENT_PROVIDER),
      command: parseOptionalString(process.env.AGENT_CLI_COMMAND) ?? parseOptionalString(process.env.CODEX_CLI_COMMAND),
      extraArgs: parseOptionalString(process.env.AGENT_CLI_ARGS) ?? parseOptionalString(process.env.CODEX_CLI_EXTRA_ARGS),
      autoRepairTimeoutMs: process.env.AGENT_AUTO_REPAIR_TIMEOUT_MS
        ? Number(process.env.AGENT_AUTO_REPAIR_TIMEOUT_MS)
        : (process.env.CODEX_AUTO_REPAIR_TIMEOUT_MS ? Number(process.env.CODEX_AUTO_REPAIR_TIMEOUT_MS) : undefined),
      autoRepairEnabled: process.env.AGENT_AUTO_REPAIR_ENABLED
        ? (process.env.AGENT_AUTO_REPAIR_ENABLED ?? "false").toLowerCase() === "true"
        : (process.env.CODEX_AUTO_REPAIR_ENABLED ?? "false").toLowerCase() === "true",
      autoRepairPromptMode: (process.env.CODEX_AUTO_REPAIR_PROMPT_MODE?.trim().toLowerCase() as "compact" | "verbose") || "compact"
    },
    codex: {
      command: process.env.CODEX_CLI_COMMAND?.trim() || undefined,
      extraArgs: process.env.CODEX_CLI_EXTRA_ARGS?.trim() || undefined,
      autoRepairTimeoutMs: process.env.CODEX_AUTO_REPAIR_TIMEOUT_MS
        ? Number(process.env.CODEX_AUTO_REPAIR_TIMEOUT_MS)
        : undefined,
      autoRepairEnabled: (process.env.CODEX_AUTO_REPAIR_ENABLED ?? "false").toLowerCase() === "true",
      autoRepairPromptMode: (process.env.CODEX_AUTO_REPAIR_PROMPT_MODE?.trim().toLowerCase() as "compact" | "verbose") || "compact"
    }
  }
};

function normalizeTestRailUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function requireTestRailConfig(fullConfig: FullConfig): RequiredTestRailRuntimeConfig {
  const testRail = fullConfig.integrations.testRail;
  const url = testRail?.url?.trim();
  const email = testRail?.email?.trim();
  const apiKey = testRail?.apiKey?.trim();

  if (!url) {
    throw new Error("Missing required TestRail environment variable: TESTRAIL_URL");
  }
  if (!email) {
    throw new Error("Missing required TestRail environment variable: TESTRAIL_EMAIL");
  }
  if (!apiKey) {
    throw new Error("Missing required TestRail environment variable: TESTRAIL_API_KEY");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid TESTRAIL_URL. Expected a valid absolute URL.");
  }

  if (!parsed.protocol || !parsed.host) {
    throw new Error("Invalid TESTRAIL_URL. Expected a valid absolute URL.");
  }

  return {
    url: normalizeTestRailUrl(url),
    email,
    apiKey
  };
}

export function requireJiraConfig(fullConfig: FullConfig): RequiredJiraRuntimeConfig {
  const jira = fullConfig.integrations.jira;
  const baseUrl = jira?.baseUrl?.trim();
  const email = jira?.email?.trim();
  const apiToken = jira?.apiToken?.trim();

  if (!baseUrl) {
    throw new Error("Missing required Jira environment variable: JIRA_BASE_URL");
  }
  if (!email) {
    throw new Error("Missing required Jira environment variable: JIRA_EMAIL");
  }
  if (!apiToken) {
    throw new Error("Missing required Jira environment variable: JIRA_API_TOKEN");
  }

  return {
    baseUrl,
    email,
    apiToken,
    projectKey: jira?.projectKey,
    acceptanceCriteriaField: jira?.acceptanceCriteriaField ?? "description",
    defaultJql: jira?.defaultJql
  };
}
