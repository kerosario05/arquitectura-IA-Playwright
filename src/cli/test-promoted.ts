import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolvePromotedSpecForExecution,
  resolvePromotedSpecTargetFromEntries,
} from "../server/jobs/discovery-batch-runner";
import {
  loadRuntimeContextFromPath,
  resolveRuntimeEntriesForCase,
} from "./runtime-context";
import type { DataContextEntry } from "../data/data-context";
import type { PromotedAutomationIndexEntry } from "../types/automation-promotion.types";
import { loadPromotedAppConfigSync } from "../automations/app-profile";
import {
  applyPromotedBrowserMode,
  resolvePromotedBrowserMode,
} from "./test-promoted-browser-mode";

function printUsage(): void {
  console.log(`
Usage: npm run test:promoted -- [options]

Options:
  --app <slug>        App slug (e.g., arquitectura-automatizacion)
  --section <slug>    Section slug (e.g., regresion-kiosko)
  --case-id <id>      TestRail case ID (e.g., 38260)
  --headed            Run tests in headed mode (visible browser)
  --headless          Force tests to run headless
  --parallel          Run tests in parallel (default: serial with workers=1)
  --workers <n>       Number of workers (default: 1 for serial execution)
  --timeout <ms>      Test timeout in milliseconds (default: 120000)
  --project <name>    Playwright project name (chromium, firefox, webkit)
  --grep <pattern>    Filter tests by name pattern
  --help              Show this help message

Examples:
  # Run all promoted specs
  npm run test:promoted

  # Run specific case
  npm run test:promoted -- --case-id 38260 --headed

  # Force headless mode
  npm run test:promoted -- --case-id 38260 --headless

  # Run specific section
  npm run test:promoted -- --app arquitectura-automatizacion --section regresion-kiosko

  # Run with custom timeout
  npm run test:promoted -- --case-id 38260 --timeout 120000

  # Run in parallel (faster, but may have race conditions)
  npm run test:promoted -- --parallel

Environment Variables:
  PROMOTED_SPEC_TIMEOUT_MS    Override default timeout (default: 120000)
  BROWSER                     Browser to use (default: chromium)
  HEADLESS                    Playwright config headless override
  AUTOMATION_HEADLESS         Force headless mode for automatic runs
`);
}

function parseArgs(args: string[]): {
  app?: string;
  section?: string;
  caseId?: string;
  headed: boolean;
  headless: boolean;
  parallel: boolean;
  workers: number;
  timeout: number;
  project?: string;
  grep?: string;
  help: boolean;
} {
  const result = {
    app: undefined as string | undefined,
    section: undefined as string | undefined,
    caseId: undefined as string | undefined,
    headed: false,
    headless: false,
    parallel: false,
    workers: 1,
    timeout: 120000,
    project: undefined as string | undefined,
    grep: undefined as string | undefined,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--app":
        result.app = next;
        i++;
        break;
      case "--section":
        result.section = next;
        i++;
        break;
      case "--case-id":
        result.caseId = next;
        i++;
        break;
      case "--headed":
        result.headed = true;
        break;
      case "--headless":
        result.headless = true;
        break;
      case "--parallel":
        result.parallel = true;
        result.workers = 0; // 0 = auto parallel
        break;
      case "--workers":
        result.workers = parseInt(next, 10);
        i++;
        break;
      case "--timeout":
        result.timeout = parseInt(next, 10);
        i++;
        break;
      case "--project":
        result.project = next;
        i++;
        break;
      case "--grep":
        result.grep = next;
        i++;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  return result;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validUrl(value: string | undefined): string | undefined {
  const candidate = nonEmpty(value);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

const PROMOTED_RUNTIME_INPUT_ENV: Record<string, string> = {
  "auth.company_identifier": "APP_COMPANY_IDENTIFIER",
  "auth.username": "APP_USERNAME",
  "auth.password": "APP_PASSWORD",
};

export type PromotedRuntimeInputResult = {
  ok: boolean;
  env: NodeJS.ProcessEnv;
  missingKey?: string;
  resolvedKeys: string[];
  resolvedSources: Record<string, "user_provided_qa_credentials" | "explicit_runtime_input" | "runtime_context" | "configured_fallback">;
};

const EXPLICIT_RUNTIME_INPUTS_ENV = "PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON";
const RUNTIME_DATA_OVERRIDES_ENV = "PROMOTED_RUNTIME_DATA_OVERRIDES_JSON";
const ALLOW_CONFIGURED_FALLBACK_ENV = "PROMOTED_RUNTIME_ALLOW_CONFIGURED_FALLBACK";

function envNameForRuntimeKey(key: string): string | undefined {
  return PROMOTED_RUNTIME_INPUT_ENV[key];
}

function normalizeRuntimeKey(key: string): string {
  return key.trim().toLowerCase();
}

function getRuntimeValue(entries: Map<string, { value?: string }>, key: string): string | undefined {
  return entries.get(normalizeRuntimeKey(key))?.value;
}

function readExplicitRuntimeInputs(baseEnv: NodeJS.ProcessEnv): Record<string, string> {
  const raw = baseEnv[EXPLICIT_RUNTIME_INPUTS_ENV];
  if (typeof raw !== "string" || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
        .map(([key, value]) => [key, String(value)])
    );
  } catch {
    return {};
  }
}

export async function preparePromotedRuntimeInputs(options: {
  contextPath: string | undefined;
  caseId: number;
  baseEnv: NodeJS.ProcessEnv;
  requiredKeys: string[];
}): Promise<PromotedRuntimeInputResult> {
  if (options.requiredKeys.length === 0) {
    return { ok: true, env: { ...options.baseEnv }, resolvedKeys: [], resolvedSources: {} };
  }

  const context = await loadRuntimeContextFromPath(options.contextPath);
  const entries = resolveRuntimeEntriesForCase(context, options.caseId) ?? [];
  const byKey = new Map(entries.map((entry) => [normalizeRuntimeKey(entry.key), entry]));
  const explicit = readExplicitRuntimeInputs(options.baseEnv);
  const explicitByKey = new Map(Object.entries(explicit).map(([key, value]) => [normalizeRuntimeKey(key), { value }]));
  const allowConfiguredFallback = options.baseEnv[ALLOW_CONFIGURED_FALLBACK_ENV] === "true";
  const resolvedSources: PromotedRuntimeInputResult["resolvedSources"] = {};
  const missingKey = options.requiredKeys.find((key) => {
    if (getRuntimeValue(explicitByKey, key)) {
      resolvedSources[key] = envNameForRuntimeKey(key) ? "user_provided_qa_credentials" : "explicit_runtime_input";
      return false;
    }
    const entry = byKey.get(normalizeRuntimeKey(key));
    if (entry && typeof entry.value === "string" && entry.value.trim().length > 0) {
      resolvedSources[key] = entry.source === "user_provided_qa_credentials"
        ? "user_provided_qa_credentials"
        : "runtime_context";
      return false;
    }
    const envName = envNameForRuntimeKey(key);
    if (allowConfiguredFallback && envName && typeof options.baseEnv[envName] === "string" && options.baseEnv[envName]!.trim().length > 0) {
      resolvedSources[key] = "configured_fallback";
      return false;
    }
    return true;
  });
  if (missingKey) {
    return { ok: false, env: { ...options.baseEnv }, missingKey, resolvedKeys: [], resolvedSources: {} };
  }

  const childEnv: NodeJS.ProcessEnv = { ...options.baseEnv };
  const runtimeDataOverrides: Record<string, string> = {};
  for (const key of options.requiredKeys) {
    const envName = PROMOTED_RUNTIME_INPUT_ENV[key];
    const explicitValue = getRuntimeValue(explicitByKey, key);
    const contextValue = getRuntimeValue(byKey, key);
    const value = explicitValue
      ?? contextValue
      ?? (allowConfiguredFallback && envName ? childEnv[envName] : undefined);
    if (typeof value !== "string") continue;
    if (envName) childEnv[envName] = value;
    if (!explicitValue && contextValue) runtimeDataOverrides[key] = contextValue;
  }
  if (Object.keys(runtimeDataOverrides).length > 0) {
    childEnv[RUNTIME_DATA_OVERRIDES_ENV] = JSON.stringify(runtimeDataOverrides);
  }
  return {
    ok: true,
    env: childEnv,
    resolvedKeys: options.requiredKeys,
    resolvedSources,
  };
}

export function resolvePromotedRuntimeInputKeys(specSource: string): string[] {
  const envKeys = Object.entries(PROMOTED_RUNTIME_INPUT_ENV)
    .filter(([, envName]) => specSource.includes(`process.env.${envName}`))
    .map(([key]) => key);
  const dataKeys = Array.from(specSource.matchAll(
    /requirePromotedData\(\s*dataContext\s*,\s*["']([^"']+)["']/g,
  )).map((match) => match[1].trim()).filter(Boolean);
  return Array.from(new Set([...envKeys, ...dataKeys]));
}

export function buildPromotedExecutionEnv(
  baseEnv: NodeJS.ProcessEnv,
  appSlug: string | undefined,
): NodeJS.ProcessEnv {
  const projectConfig = appSlug
    ? loadPromotedAppConfigSync({ appSlug })
    : undefined;
  return buildPromotedExecutionEnvWithConfig(baseEnv, appSlug, projectConfig);
}

export function buildPromotedExecutionEnvWithConfig(
  baseEnv: NodeJS.ProcessEnv,
  appSlug: string | undefined,
  projectConfig: ReturnType<typeof loadPromotedAppConfigSync>,
): NodeJS.ProcessEnv {
  const projectConfiguredUrl = validUrl(projectConfig?.baseUrl);
  const legacyUrl = validUrl(baseEnv.APP_BASE_URL);
  const effectiveUrl = projectConfiguredUrl ?? legacyUrl;
  if (!effectiveUrl) {
    throw new Error(`[promoted-runtime-config] missing valid project baseUrl and APP_BASE_URL fallback appSlug=${appSlug ?? "unknown"}`);
  }
  const source = projectConfiguredUrl ? "project_config" : "legacy_env";
  console.log(`[promoted-runtime-config] appSlug=${appSlug ?? "unknown"} baseUrlSource=${source} projectScoped=${Boolean(projectConfiguredUrl)}`);
  const { APP_IGNORE_HTTPS_ERRORS: _legacyTlsValue, ...envWithoutTls } = baseEnv;
  return {
    ...envWithoutTls,
    APP_BASE_URL: effectiveUrl,
    ...(projectConfig?.ignoreHTTPSErrors === undefined
      ? {}
      : { APP_IGNORE_HTTPS_ERRORS: String(projectConfig.ignoreHTTPSErrors) }),
  };
}

function buildTestPath(options: { app?: string; section?: string; caseId?: string }): string | null {
  if (options.caseId) return null;

  if (options.app && options.section) {
    return `automations/apps/${options.app}/sections/${options.section}/cases`;
  }

  if (options.app) {
    return `automations/apps/${options.app}`;
  }

  // Default: all promoted specs
  return 'automations/apps';
}

async function resolvePromotedSpecPath(options: { app?: string; section?: string; caseId: string }): Promise<string | null> {
  const validation = await resolvePromotedSpecForExecution({
    caseId: Number(options.caseId),
    appSlug: options.app,
    sectionSlug: options.section,
  });
  return validation.reusable ? validation.specPath ?? null : null;
}

export function resolvePromotedSpecTarget(
  entries: PromotedAutomationIndexEntry[],
  options: { app?: string; section?: string; caseId: string },
  fileExists: (filePath: string) => boolean,
): string | null {
  const caseId = Number(options.caseId);
  if (!Number.isInteger(caseId) || caseId <= 0) return null;
  const validation = resolvePromotedSpecTargetFromEntries({
    entries,
    caseId,
    appSlug: options.app,
    sectionSlug: options.section,
    fileExists,
  });
  return validation.reusable ? validation.specPath ?? null : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  let testPath = buildTestPath(options);
  if (options.caseId) {
    const specPath = await resolvePromotedSpecPath({ ...options, caseId: options.caseId });
    if (!specPath) {
      console.error(`[test:promoted] caseId=${options.caseId} specPath=none`);
      console.error(`[test:promoted] Refusing execution: exact promoted case.spec.ts could not be resolved safely.`);
      process.exitCode = 1;
      return;
    }
    testPath = path.relative(process.cwd(), specPath).replace(/\\/g, "/") || ".";
    console.log(`[test:promoted] caseId=${options.caseId} specPath=${specPath}`);
  }
  const timeout = process.env.PROMOTED_SPEC_TIMEOUT_MS 
    ? parseInt(process.env.PROMOTED_SPEC_TIMEOUT_MS, 10) 
    : options.timeout;
  const workers = options.parallel ? 0 : options.workers;

  const playwrightArgs: string[] = [];

  // Keep execution semantics identical for default, app, section and exact
  // case runs. Without the apps config Playwright falls back to its default
  // discovery rules and executes candidate artifacts as promoted specs.
  playwrightArgs.push("--config=playwright.config.apps.ts");

  // Add test path if specified
  if (testPath) {
    playwrightArgs.push(testPath);
  } else {
    playwrightArgs.push("automations/apps");
  }

  // Add workers configuration
  if (workers === 0) {
    // Parallel mode - don't set workers flag, let Playwright auto-detect
    console.log("[test:promoted] Running in parallel mode");
  } else {
    playwrightArgs.push(`--workers=${workers}`);
    if (workers === 1) {
      console.log("[test:promoted] Running in serial mode (workers=1)");
    } else {
      console.log(`[test:promoted] Running with ${workers} workers`);
    }
  }

  // Add timeout
  playwrightArgs.push(`--timeout=${timeout}`);
  console.log(`[test:promoted] Using timeout: ${timeout}ms`);

  // Add project/browser
  if (options.project) {
    playwrightArgs.push(`--project=${options.project}`);
    console.log(`[test:promoted] Using project: ${options.project}`);
  }

  // Add grep filter
  if (options.grep) {
    playwrightArgs.push(`--grep=${options.grep}`);
    console.log(`[test:promoted] Filtering by: ${options.grep}`);
  }

  // Build full command - spawn node directly with Playwright CLI to avoid shell interpretation
  const playwrightCliPath = path.resolve(process.cwd(), "node_modules/@playwright/test/cli.js");
  
  // Spawn node directly with Playwright CLI JS file
  // This avoids any shell interpretation of | characters
  const spawnCommand = process.execPath; // node executable
  const resolvedAppSlug = nonEmpty(options.app) ?? nonEmpty(process.env.APP_SLUG);
  const resolvedSectionSlug = nonEmpty(options.section) ?? nonEmpty(process.env.SECTION_SLUG);
  const basePlaywrightEnv: NodeJS.ProcessEnv = {
    ...(process.env as NodeJS.ProcessEnv),
    ...(resolvedAppSlug ? { APP_SLUG: resolvedAppSlug } : {}),
    ...(resolvedSectionSlug ? { SECTION_SLUG: resolvedSectionSlug } : {}),
    ...(resolvedAppSlug ? { EVIDENCE_APP_SLUG: resolvedAppSlug } : {}),
    ...(resolvedSectionSlug ? { EVIDENCE_SECTION_SLUG: resolvedSectionSlug } : {}),
  };
  const projectScopedPlaywrightEnv = buildPromotedExecutionEnv(basePlaywrightEnv, resolvedAppSlug);
  let promotedRuntimeEnv = projectScopedPlaywrightEnv;
  if (options.caseId && testPath) {
    const specSource = await fs.readFile(path.resolve(process.cwd(), testPath), "utf8");
    const requiredKeys = resolvePromotedRuntimeInputKeys(specSource);
    const runtimeInputs = await preparePromotedRuntimeInputs({
      contextPath: process.env.DISCOVERY_RUNTIME_CONTEXT,
      caseId: Number(options.caseId),
      baseEnv: projectScopedPlaywrightEnv,
      requiredKeys,
    });
    if (!runtimeInputs.ok) {
      console.error(`[test:promoted] pre-browser input gate blocked missingKey=${runtimeInputs.missingKey}`);
      process.exitCode = 1;
      return;
    }
    for (const key of runtimeInputs.resolvedKeys) {
      console.log(`[promoted-runtime-input] key=${key} source=${runtimeInputs.resolvedSources[key] ?? "runtime_context"} present=true`);
    }
    promotedRuntimeEnv = runtimeInputs.env;
  }
  const browserMode = resolvePromotedBrowserMode({
    headedFlag: options.headed,
    headlessFlag: options.headless,
    automationHeadless: process.env.AUTOMATION_HEADLESS,
    automationSource: process.env.AUTOMATION_SOURCE,
  });
  const browserModeApplied = applyPromotedBrowserMode({
    baseEnv: promotedRuntimeEnv,
    playwrightArgs,
    browserMode,
  });
  const finalPlaywrightArgs = browserModeApplied.playwrightArgs;
  const playwrightEnv = browserModeApplied.playwrightEnv;
  console.log(`[test:promoted] browserMode=${browserMode.mode} source=${browserMode.source}`);
  console.log(`[test:promoted] Executing: playwright test ${finalPlaywrightArgs.join(" ")}\n`);
  const spawnArgs = [playwrightCliPath, "test", ...finalPlaywrightArgs];
  
  const child = spawn(spawnCommand, spawnArgs, {
    stdio: "inherit",
    env: playwrightEnv,
    shell: false // Critical: prevents any shell interpretation of special chars
  });

  child.on("close", (code) => {
    process.exit(code ?? 1);
  });

  child.on("error", (err) => {
    console.error("[test:promoted] Failed to start Playwright:", err);
    process.exit(1);
  });
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("test-promoted.ts")) {
  main().catch((error) => {
    console.error(`[test:promoted] Failed to resolve execution target: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
