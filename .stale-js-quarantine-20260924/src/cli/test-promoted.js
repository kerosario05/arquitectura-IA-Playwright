"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.preparePromotedRuntimeInputs = preparePromotedRuntimeInputs;
exports.resolvePromotedRuntimeInputKeys = resolvePromotedRuntimeInputKeys;
exports.buildPromotedExecutionEnv = buildPromotedExecutionEnv;
exports.resolvePromotedExecutionEnv = resolvePromotedExecutionEnv;
exports.buildPromotedExecutionEnvWithConfig = buildPromotedExecutionEnvWithConfig;
exports.resolvePromotedSpecTarget = resolvePromotedSpecTarget;
const node_child_process_1 = require("node:child_process");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const discovery_batch_runner_1 = require("../server/jobs/discovery-batch-runner");
const runtime_context_1 = require("./runtime-context");
const app_profile_1 = require("../automations/app-profile");
const runtime_web_config_1 = require("./runtime-web-config");
const test_promoted_browser_mode_1 = require("./test-promoted-browser-mode");
const pre_business_retry_policy_1 = require("../discovery/pre-business-retry-policy");
function printUsage() {
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
function parseArgs(args) {
    const result = {
        app: undefined,
        section: undefined,
        caseId: undefined,
        headed: false,
        headless: false,
        parallel: false,
        workers: 1,
        timeout: 120000,
        project: undefined,
        grep: undefined,
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
function nonEmpty(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function validUrl(value) {
    const candidate = nonEmpty(value);
    if (!candidate)
        return undefined;
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : undefined;
    }
    catch {
        return undefined;
    }
}
const PROMOTED_RUNTIME_INPUT_ENV = {
    "auth.company_identifier": "APP_COMPANY_IDENTIFIER",
    "auth.username": "APP_USERNAME",
    "auth.password": "APP_PASSWORD",
};
const EXPLICIT_RUNTIME_INPUTS_ENV = "PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON";
const RUNTIME_DATA_OVERRIDES_ENV = "PROMOTED_RUNTIME_DATA_OVERRIDES_JSON";
const ALLOW_CONFIGURED_FALLBACK_ENV = "PROMOTED_RUNTIME_ALLOW_CONFIGURED_FALLBACK";
function envNameForRuntimeKey(key) {
    return PROMOTED_RUNTIME_INPUT_ENV[key];
}
function normalizeRuntimeKey(key) {
    return key.trim().toLowerCase();
}
function getRuntimeValue(entries, key) {
    return entries.get(normalizeRuntimeKey(key))?.value;
}
function readExplicitRuntimeInputs(baseEnv) {
    const raw = baseEnv[EXPLICIT_RUNTIME_INPUTS_ENV];
    if (typeof raw !== "string" || raw.trim().length === 0)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        return Object.fromEntries(Object.entries(parsed)
            .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
            .map(([key, value]) => [key, String(value)]));
    }
    catch {
        return {};
    }
}
async function preparePromotedRuntimeInputs(options) {
    if (options.requiredKeys.length === 0) {
        return { ok: true, env: { ...options.baseEnv }, resolvedKeys: [], resolvedSources: {} };
    }
    const context = await (0, runtime_context_1.loadRuntimeContextFromPath)(options.contextPath);
    const entries = (0, runtime_context_1.resolveRuntimeEntriesForCase)(context, options.caseId) ?? [];
    const byKey = new Map(entries.map((entry) => [normalizeRuntimeKey(entry.key), entry]));
    const explicit = readExplicitRuntimeInputs(options.baseEnv);
    const explicitByKey = new Map(Object.entries(explicit).map(([key, value]) => [normalizeRuntimeKey(key), { value }]));
    const allowConfiguredFallback = options.baseEnv[ALLOW_CONFIGURED_FALLBACK_ENV] === "true";
    const resolvedSources = {};
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
        if (allowConfiguredFallback && envName && typeof options.baseEnv[envName] === "string" && options.baseEnv[envName].trim().length > 0) {
            resolvedSources[key] = "configured_fallback";
            return false;
        }
        return true;
    });
    if (missingKey) {
        return { ok: false, env: { ...options.baseEnv }, missingKey, resolvedKeys: [], resolvedSources: {} };
    }
    const childEnv = { ...options.baseEnv };
    const runtimeDataOverrides = {};
    for (const key of options.requiredKeys) {
        const envName = PROMOTED_RUNTIME_INPUT_ENV[key];
        const explicitValue = getRuntimeValue(explicitByKey, key);
        const contextValue = getRuntimeValue(byKey, key);
        const value = explicitValue
            ?? contextValue
            ?? (allowConfiguredFallback && envName ? childEnv[envName] : undefined);
        if (typeof value !== "string")
            continue;
        if (envName)
            childEnv[envName] = value;
        if (!explicitValue && contextValue)
            runtimeDataOverrides[key] = contextValue;
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
function resolvePromotedRuntimeInputKeys(specSource) {
    const envKeys = Object.entries(PROMOTED_RUNTIME_INPUT_ENV)
        .filter(([, envName]) => specSource.includes(`process.env.${envName}`))
        .map(([key]) => key);
    const dataKeys = Array.from(specSource.matchAll(/requirePromotedData\(\s*dataContext\s*,\s*["']([^"']+)["']/g)).map((match) => match[1].trim()).filter(Boolean);
    return Array.from(new Set([...envKeys, ...dataKeys]));
}
function buildPromotedExecutionEnv(baseEnv, appSlug) {
    const projectConfig = appSlug
        ? (0, app_profile_1.loadPromotedAppConfigSync)({ appSlug })
        : undefined;
    return buildPromotedExecutionEnvWithConfig(baseEnv, appSlug, projectConfig);
}
/** Resolve the promoted runner's URL through the same SQL-first authority as discovery. */
async function resolvePromotedExecutionEnv(baseEnv, appSlug) {
    if (!appSlug)
        return buildPromotedExecutionEnv(baseEnv, appSlug);
    const resolution = await (0, runtime_web_config_1.resolveRuntimeWebBaseUrl)(appSlug);
    let materializedConfig;
    try {
        materializedConfig = (0, app_profile_1.loadPromotedAppConfigSync)({ appSlug });
    }
    catch {
        materializedConfig = undefined;
    }
    const materializedUrl = validUrl(materializedConfig?.baseUrl);
    console.log(`[promoted-runtime-config] selectedProject=${appSlug}`
        + ` sqlConfiguredUrl=${resolution.source === "project_sql" ? resolution.configured ?? "none" : "unavailable"}`
        + ` materializedConfiguredUrl=${materializedUrl ?? "none"}`
        + ` effectivePlaywrightUrl=${resolution.effective}`
        + ` authority=${resolution.source}`);
    const runtimeConfig = {
        ...(materializedConfig ?? {}),
        baseUrl: resolution.effective,
        ...(resolution.ignoreHTTPSErrors === undefined ? {} : { ignoreHTTPSErrors: resolution.ignoreHTTPSErrors }),
    };
    return buildPromotedExecutionEnvWithConfig(baseEnv, appSlug, runtimeConfig, resolution.source);
}
function buildPromotedExecutionEnvWithConfig(baseEnv, appSlug, projectConfig, sourceOverride) {
    const projectConfiguredUrl = validUrl(projectConfig?.baseUrl);
    const legacyUrl = validUrl(baseEnv.APP_BASE_URL);
    const effectiveUrl = projectConfiguredUrl ?? legacyUrl;
    if (!effectiveUrl) {
        throw new Error(`[promoted-runtime-config] missing valid project baseUrl and APP_BASE_URL fallback appSlug=${appSlug ?? "unknown"}`);
    }
    const source = sourceOverride ?? (projectConfiguredUrl ? "project_config" : "legacy_env");
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
function buildTestPath(options) {
    if (options.caseId)
        return null;
    if (options.app && options.section) {
        return `automations/apps/${options.app}/sections/${options.section}/cases`;
    }
    if (options.app) {
        return `automations/apps/${options.app}`;
    }
    // Default: all promoted specs
    return 'automations/apps';
}
function readPromotedRuntimeAttempt(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const match = lines[index]?.match(/^\[promoted-runtime-attempt\]\s+(\{.*\})\s*$/);
        if (!match)
            continue;
        try {
            const parsed = JSON.parse(match[1]);
            return parsed && typeof parsed === "object" ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
function isRetryEligiblePromotedAttempt(attempt, diagnostics) {
    if (!diagnostics)
        return false;
    return (0, pre_business_retry_policy_1.shouldRetryScenario)({
        attempt,
        businessSurfaceReached: diagnostics.businessSurfaceReached === true,
        failureClassification: diagnostics.failureClassification,
        authRejected: diagnostics.authRejected === true,
        applicationError: diagnostics.applicationError === true,
        functionalBusinessExecutionStarted: diagnostics.functionalBusinessExecutionStarted === true,
        oracleEvaluationStarted: diagnostics.oracleEvaluationStarted === true,
    });
}
async function runPromotedPlaywrightChild(spawnCommand, spawnArgs, env) {
    const lines = [];
    return await new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(spawnCommand, spawnArgs, {
            stdio: ["ignore", "pipe", "pipe"],
            env,
            shell: false,
        });
        const attach = (stream) => {
            if (!stream)
                return;
            let pending = "";
            stream.on("data", (chunk) => {
                pending += chunk.toString();
                const parts = pending.split(/\r?\n/);
                pending = parts.pop() ?? "";
                for (const part of parts) {
                    if (part.trim())
                        lines.push(part);
                    process.stdout.write(`${part}\n`);
                }
            });
            stream.on("end", () => {
                if (!pending.trim())
                    return;
                lines.push(pending);
                process.stdout.write(`${pending}\n`);
            });
        };
        attach(child.stdout);
        attach(child.stderr);
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, lines }));
    });
}
async function resolvePromotedSpecPath(options) {
    const validation = await (0, discovery_batch_runner_1.resolvePromotedSpecForExecution)({
        caseId: Number(options.caseId),
        appSlug: options.app,
        sectionSlug: options.section,
    });
    return validation.reusable ? validation.specPath ?? null : null;
}
function resolvePromotedSpecTarget(entries, options, fileExists) {
    const caseId = Number(options.caseId);
    if (!Number.isInteger(caseId) || caseId <= 0)
        return null;
    const validation = (0, discovery_batch_runner_1.resolvePromotedSpecTargetFromEntries)({
        entries,
        caseId,
        appSlug: options.app,
        sectionSlug: options.section,
        fileExists,
    });
    return validation.reusable ? validation.specPath ?? null : null;
}
async function main() {
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
        testPath = node_path_1.default.relative(process.cwd(), specPath).replace(/\\/g, "/") || ".";
        console.log(`[test:promoted] caseId=${options.caseId} specPath=${specPath}`);
    }
    const timeout = process.env.PROMOTED_SPEC_TIMEOUT_MS
        ? parseInt(process.env.PROMOTED_SPEC_TIMEOUT_MS, 10)
        : options.timeout;
    const workers = options.parallel ? 0 : options.workers;
    const playwrightArgs = [];
    // Keep execution semantics identical for default, app, section and exact
    // case runs. Without the apps config Playwright falls back to its default
    // discovery rules and executes candidate artifacts as promoted specs.
    playwrightArgs.push("--config=playwright.config.apps.ts");
    // Add test path if specified
    if (testPath) {
        playwrightArgs.push(testPath);
    }
    else {
        playwrightArgs.push("automations/apps");
    }
    // Add workers configuration
    if (workers === 0) {
        // Parallel mode - don't set workers flag, let Playwright auto-detect
        console.log("[test:promoted] Running in parallel mode");
    }
    else {
        playwrightArgs.push(`--workers=${workers}`);
        if (workers === 1) {
            console.log("[test:promoted] Running in serial mode (workers=1)");
        }
        else {
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
    const playwrightCliPath = node_path_1.default.resolve(process.cwd(), "node_modules/@playwright/test/cli.js");
    // Spawn node directly with Playwright CLI JS file
    // This avoids any shell interpretation of | characters
    const spawnCommand = process.execPath; // node executable
    const resolvedAppSlug = nonEmpty(options.app) ?? nonEmpty(process.env.APP_SLUG);
    const resolvedSectionSlug = nonEmpty(options.section) ?? nonEmpty(process.env.SECTION_SLUG);
    const basePlaywrightEnv = {
        ...process.env,
        ...(resolvedAppSlug ? { APP_SLUG: resolvedAppSlug } : {}),
        ...(resolvedSectionSlug ? { SECTION_SLUG: resolvedSectionSlug } : {}),
        ...(resolvedAppSlug ? { EVIDENCE_APP_SLUG: resolvedAppSlug } : {}),
        ...(resolvedSectionSlug ? { EVIDENCE_SECTION_SLUG: resolvedSectionSlug } : {}),
    };
    const projectScopedPlaywrightEnv = await resolvePromotedExecutionEnv(basePlaywrightEnv, resolvedAppSlug);
    let promotedRuntimeEnv = projectScopedPlaywrightEnv;
    if (options.caseId && testPath) {
        const specSource = await promises_1.default.readFile(node_path_1.default.resolve(process.cwd(), testPath), "utf8");
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
    const browserMode = (0, test_promoted_browser_mode_1.resolvePromotedBrowserMode)({
        headedFlag: options.headed,
        headlessFlag: options.headless,
        automationHeadless: process.env.AUTOMATION_HEADLESS,
        automationSource: process.env.AUTOMATION_SOURCE,
    });
    const browserModeApplied = (0, test_promoted_browser_mode_1.applyPromotedBrowserMode)({
        baseEnv: promotedRuntimeEnv,
        playwrightArgs,
        browserMode,
    });
    const finalPlaywrightArgs = browserModeApplied.playwrightArgs;
    const playwrightEnv = browserModeApplied.playwrightEnv;
    console.log(`[test:promoted] browserMode=${browserMode.mode} source=${browserMode.source}`);
    console.log(`[test:promoted] Executing: playwright test ${finalPlaywrightArgs.join(" ")}\n`);
    const spawnArgs = [playwrightCliPath, "test", ...finalPlaywrightArgs];
    const retryScope = Boolean(options.caseId || options.grep);
    let attempt = 1;
    while (true) {
        const attemptEnv = {
            ...playwrightEnv,
            PROMOTED_RUNTIME_ATTEMPT: String(attempt),
        };
        console.log(`[pre-business-retry] scenarioScope=${retryScope} attempt=${attempt}/${pre_business_retry_policy_1.MAX_SCENARIO_ATTEMPTS} freshBrowserContextPage=${attempt > 1}`);
        let result;
        try {
            result = await runPromotedPlaywrightChild(spawnCommand, spawnArgs, attemptEnv);
        }
        catch (err) {
            console.error("[test:promoted] Failed to start Playwright:", err);
            process.exitCode = 1;
            return;
        }
        const diagnostics = readPromotedRuntimeAttempt(result.lines);
        const retryEligible = retryScope && result.code !== 0 && isRetryEligiblePromotedAttempt(attempt, diagnostics);
        console.log(`[pre-business-retry] attempt=${attempt} `
            + `failureClassification=${diagnostics?.failureClassification ?? "unavailable"} `
            + `businessSurfaceReached=${diagnostics?.businessSurfaceReached ?? "unavailable"} `
            + `retryEligible=${retryEligible} retryTriggered=${retryEligible && attempt < pre_business_retry_policy_1.MAX_SCENARIO_ATTEMPTS}`);
        if (!retryEligible || attempt >= pre_business_retry_policy_1.MAX_SCENARIO_ATTEMPTS) {
            process.exitCode = result.code;
            return;
        }
        attempt += 1;
    }
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("test-promoted.ts")) {
    main().catch((error) => {
        console.error(`[test:promoted] Failed to resolve execution target: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
