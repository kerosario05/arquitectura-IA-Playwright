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

dotenv.config();

const allowedBrowsers: BrowserName[] = ["chromium", "firefox", "webkit"];
const allowedLoginModes: LoginMode[] = ["password", "no_login", "manual"];
const allowedMissingInputBehaviors: MissingInputBehavior[] = ["fail", "prompt", "skip"];

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

function parseAgentProvider(rawValue?: string): "codex" | "copilot" | "custom" | undefined {
  if (!rawValue || !rawValue.trim()) {
    return undefined;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "codex" || normalized === "copilot" || normalized === "custom") {
    return normalized;
  }

  throw new Error("Invalid AGENT_PROVIDER value. Allowed values: codex, copilot, custom.");
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
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error("Invalid APP_TEST_DATA_JSON. Values must be string, number or boolean.");
    }
    result[key] = value as TestDataValue;
  }

  return result;
}

function parseTestDataAliases(rawValue?: string): TestDataAliasesMap {
  if (!rawValue || !rawValue.trim()) {
    return {};
  }

  const parsed = parseFlatJsonObject(rawValue, "APP_TEST_DATA_ALIASES_JSON");
  const result: TestDataAliasesMap = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error("Invalid APP_TEST_DATA_ALIASES_JSON. Every value must be an array of strings.");
    }
    result[key] = value;
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

function parseMissingInputBehavior(rawValue?: string): MissingInputBehavior {
  const value = (rawValue ?? "fail").trim().toLowerCase();
  if (!allowedMissingInputBehaviors.includes(value as MissingInputBehavior)) {
    throw new Error(
      `Invalid MISSING_INPUT_BEHAVIOR value: ${rawValue}. Allowed values: ${allowedMissingInputBehaviors.join(
        ", "
      )}`
    );
  }
  return value as MissingInputBehavior;
}

const appBaseUrl = getRequiredEnv("APP_BASE_URL");
const appLoginMode = parseLoginMode(getRequiredEnv("APP_LOGIN_MODE"));
const headless = parseBoolean(getRequiredEnv("HEADLESS"), "HEADLESS");
const browser = parseBrowser(getRequiredEnv("BROWSER"));
const evidenceDir = getRequiredEnv("EVIDENCE_DIR");
const defaultTimeoutMs = parseNumber(getRequiredEnv("DEFAULT_TIMEOUT_MS"), "DEFAULT_TIMEOUT_MS");

export const config: FullConfig = {
  app: {
    name: process.env.APP_NAME?.trim() || undefined,
    baseUrl: appBaseUrl,
    loginMode: appLoginMode,
    username: process.env.APP_USERNAME?.trim() || undefined,
    password: process.env.APP_PASSWORD?.trim() || undefined,
    extraLoginFields: parseExtraLoginFields(process.env.APP_EXTRA_LOGIN_FIELDS_JSON),
    testData: parseTestData(process.env.APP_TEST_DATA_JSON),
    testDataAliases: parseTestDataAliases(process.env.APP_TEST_DATA_ALIASES_JSON),
    missingInputBehavior: parseMissingInputBehavior(process.env.MISSING_INPUT_BEHAVIOR),
    appProfile: normalizeAppProfile(process.env.APP_PROFILE)
  },
  execution: {
    browser,
    headless,
    evidenceDir,
    defaultTimeoutMs
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
      projectKey: process.env.JIRA_PROJECT_KEY?.trim() || undefined
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
      ) ?? 3
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
