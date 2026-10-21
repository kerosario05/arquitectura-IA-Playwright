import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { validateExecutionPlan } from "../plans/execution-plan-validator";
import { buildAutomationId } from "../automations/automation-naming";
import { buildAppAutomationPaths, deriveAppProfile } from "../automations/app-profile";
import { loadAutomationIndex, saveAutomationIndex, upsertAutomationIndexEntry } from "../automations/automation-index";
import { buildDataContext } from "../data/data-context";
import { buildPromotedDataManifest, savePromotedDataManifestSync } from "../data/promoted-data";
import type { FullConfig } from "../types/env.types";
import type { PromotedAutomationIndexEntry } from "../types/automation-promotion.types";
import type { ExecutionPlan } from "../types/execution-plan.types";
import { compileJiraSpec, type JiraSpecScenarioMetadata } from "./jira-spec-compiler";
import { resolveJiraSpecVerificationTimeoutMs } from "./jira-spec-timeout";
export { resolveJiraSpecVerificationTimeoutMs } from "./jira-spec-timeout";

const execFile = promisify(execFileCallback);

export type PromoteJiraSpecInput = {
  plan: ExecutionPlan;
  sourceScenario: JiraSpecScenarioMetadata;
  appSlug: string;
  baseUrl: string;
  fullConfig: FullConfig;
  runtimeValues: Record<string, string>;
  sectionSlug: string;
  overwrite: boolean;
  timeoutMs?: number;
  headed?: boolean;
  signal?: AbortSignal;
};

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.jira-tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(filePath, { force: true });
    await fs.rename(tempPath, filePath).catch(async renameError => {
      await fs.rm(tempPath, { force: true });
      throw renameError ?? error;
    });
  }
}

async function writeSpecAtomic(filePath: string, source: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.jira-tmp`;
  await fs.writeFile(tempPath, source, "utf8");
  try { await fs.rename(tempPath, filePath); }
  catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(tempPath, filePath);
  }
}

export type JiraSpecVerificationFailureCategory = "timeout" | "compile" | "test_failure" | "infrastructure" | "unknown";

export class JiraSpecVerificationError extends Error {
  readonly code = "JIRA_SPEC_VERIFICATION_FAILED";
  constructor(
    readonly category: JiraSpecVerificationFailureCategory,
    readonly diagnosticPath: string,
    readonly artifactsDir: string,
  ) {
    super("JIRA_SPEC_VERIFICATION_FAILED");
    this.name = "JiraSpecVerificationError";
  }
}

function redactVerificationOutput(output: string, secrets: Array<string | undefined>): string {
  let safe = output;
  for (const secret of secrets) {
    if (!secret) continue;
    // Short values such as a test amount can occur inside durations, line numbers,
    // and other diagnostics. Redact them only as whole tokens to keep reports useful.
    if (secret.length < 4) {
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      safe = safe.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"), "[REDACTED]");
    } else safe = safe.split(secret).join("[REDACTED]");
  }
  return safe.slice(-20_000);
}

function classifyVerificationFailure(error: unknown, output: string): JiraSpecVerificationFailureCategory {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ETIMEDOUT" || /timed? ?out|timeout/i.test(message)) return "timeout";
  if (/Cannot find module|Cannot find name|TS\d{4}|SyntaxError|Transform failed|failed to compile/i.test(output)) return "compile";
  if (/no tests found|Error:.*(ECONNREFUSED|ENOTFOUND|CERT_|net::ERR_)/i.test(output)) return "infrastructure";
  if (/Expected:|Received:|AssertionError|expect\(/i.test(output)
    || (typeof code === "number" && code !== 0) || /\bfailed\b|Test timeout/i.test(output)) return "test_failure";
  return "unknown";
}

export async function persistJiraSpecVerificationFailure(input: {
  error: unknown;
  output: string;
  secrets: Array<string | undefined>;
  specPath: string;
  artifactsDir: string;
  diagnosticPath: string;
}): Promise<{ category: JiraSpecVerificationFailureCategory; diagnosticPath: string }> {
  const category = classifyVerificationFailure(input.error, input.output);
  const safeOutput = redactVerificationOutput(input.output, input.secrets);
  const diagnostic = {
    schemaVersion: 1,
    status: "failed",
    category,
    specPath: input.specPath,
    artifactsDir: input.artifactsDir,
    createdAt: new Date().toISOString(),
    output: safeOutput,
  };
  await fs.mkdir(path.dirname(input.diagnosticPath), { recursive: true });
  await fs.writeFile(input.diagnosticPath, JSON.stringify(diagnostic, null, 2), "utf8");
  return { category, diagnosticPath: input.diagnosticPath };
}

async function verifyJiraSpec(specPath: string, input: PromoteJiraSpecInput, timeoutMs: number): Promise<void> {
  const env = {
    ...process.env,
    APP_BASE_URL: input.baseUrl,
    APP_SLUG: input.appSlug,
    APP_PROFILE: input.appSlug,
    HEADLESS: input.headed ? "false" : "true",
    ...(input.fullConfig.app.ignoreHTTPSErrors === undefined ? {} : { APP_IGNORE_HTTPS_ERRORS: String(input.fullConfig.app.ignoreHTTPSErrors) }),
    APP_TEST_DATA_JSON: JSON.stringify(input.fullConfig.app.rawTestData ?? {}),
    ...(input.fullConfig.app.username ? { APP_USERNAME: input.fullConfig.app.username } : {}),
    ...(input.fullConfig.app.password ? { APP_PASSWORD: input.fullConfig.app.password } : {}),
    JIRA_SPEC_RUNTIME_VALUES_JSON: JSON.stringify(input.runtimeValues),
  };
  const verificationKey = `${input.appSlug}-${input.plan.scenario.externalId}-${process.pid}-${Date.now()}`
    .replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 160);
  const artifactsDir = path.resolve(".artifacts", "jira-spec-verification", verificationKey);
  const diagnosticPath = path.join(artifactsDir, "diagnostic.json");
  try {
    input.signal?.throwIfAborted();
    await execFile(process.execPath, [require.resolve("@playwright/test/cli"), "test", specPath.replace(/\\/g, "/"),
      "--config=playwright.config.ts", `--timeout=${timeoutMs}`, `--output=${artifactsDir}`, "--reporter=list"],
    { cwd: process.cwd(), env, timeout: timeoutMs + 30000, maxBuffer: 2 * 1024 * 1024, signal: input.signal });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    const output = `${String((error as { stdout?: unknown }).stdout ?? "")}\n${String((error as { stderr?: unknown }).stderr ?? "")}`;
    const persisted = await persistJiraSpecVerificationFailure({ error, output, specPath, artifactsDir, diagnosticPath,
      secrets: [...Object.values(input.runtimeValues), input.fullConfig.app.password, input.fullConfig.app.username] });
    console.error(`[jira-spec-verification] category=${persisted.category} diagnostic=${persisted.diagnosticPath}`);
    throw new JiraSpecVerificationError(persisted.category, persisted.diagnosticPath, artifactsDir);
  }
}

/** Fail closed if any canonical promoted output exists. Retained case.jira-candidate-*.spec.ts files are not canonical. */
export async function assertNoCanonicalJiraOutputs(canonicalPaths: string[]): Promise<void> {
  for (const canonicalPath of canonicalPaths) {
    try {
      await fs.access(canonicalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error("JIRA_SPEC_ALREADY_EXISTS");
  }
}

export async function promoteJiraSpec(input: PromoteJiraSpecInput): Promise<PromotedAutomationIndexEntry> {
  const validation = validateExecutionPlan(input.plan);
  if (!validation.valid || input.plan.status !== "validated") throw new Error("JIRA_SPEC_PLAN_NOT_VALIDATED");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(input.appSlug) || !/^jira-[a-z0-9][a-z0-9-]*$/i.test(input.sectionSlug)) {
    throw new Error("JIRA_SPEC_NAMESPACE_INVALID");
  }

  const appProfile = deriveAppProfile({ appProfile: input.appSlug, baseUrl: input.baseUrl, appName: input.appSlug });
  const automationId = buildAutomationId({ externalId: input.plan.scenario.externalId, title: input.plan.scenario.title });
  const appPaths = buildAppAutomationPaths(appProfile, automationId, undefined, input.sectionSlug);
  if (!appPaths.caseDir || !appPaths.specPath || !appPaths.planPath || !appPaths.caseConfigPath || !appPaths.caseAutomationPath) {
    throw new Error("JIRA_SPEC_OUTPUT_PATH_UNAVAILABLE");
  }

  if (!input.overwrite) {
    await assertNoCanonicalJiraOutputs([appPaths.specPath, appPaths.planPath, appPaths.caseConfigPath,
      appPaths.caseAutomationPath, path.join(appPaths.caseDir, "case.meta.json"), path.join(appPaths.caseDir, "promoted-data.json")]);
  }

  if (input.overwrite) {
    try {
      await fs.access(appPaths.caseDir);
      const backupDir = path.resolve(".artifacts", "jira-spec-backups", `${input.appSlug}-${automationId}-${Date.now()}`);
      await fs.mkdir(path.dirname(backupDir), { recursive: true });
      await fs.cp(appPaths.caseDir, backupDir, { recursive: true, errorOnExist: true, force: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("JIRA_SPEC_LINEAGE_BACKUP_FAILED");
    }
  }

  // Keep the child Playwright test and its parent verifier on exactly the same
  // budget, including any explicitly configured verification timeout.
  const semanticAssertionCount = input.plan.steps.filter(step => step.action === "assertVisible" || step.action === "assertText").length;
  const assertionAiTimeoutMs = Number(process.env.AI_JIRA_ASSERTION_TIMEOUT_MS);
  const timeoutMs = resolveJiraSpecVerificationTimeoutMs(input.plan.steps.length, input.timeoutMs,
    semanticAssertionCount, assertionAiTimeoutMs);
  const compiled = compileJiraSpec({ plan: input.plan, sourceScenario: input.sourceScenario, appSlug: input.appSlug,
    sectionSlug: input.sectionSlug, automationId, specPath: appPaths.specPath, verificationTimeoutMs: timeoutMs });
  if (compiled.unsupported.length) throw new Error(`JIRA_SPEC_CAPABILITY_UNSUPPORTED:${compiled.unsupported.join(",")}`);

  const candidatePath = path.join(appPaths.caseDir, `case.jira-candidate-${process.pid}-${Date.now()}.spec.ts`);
  try {
    await writeSpecAtomic(candidatePath, compiled.source);
    await verifyJiraSpec(candidatePath, input, timeoutMs);
    input.signal?.throwIfAborted();
  } catch (error) { throw error; }

  const planPayload = { ...input.plan, sourceScenario: input.sourceScenario };
  const dataContext = buildDataContext(input.fullConfig);
  await writeJsonAtomic(appPaths.planPath, planPayload);
  await writeJsonAtomic(path.join(appPaths.caseDir, "case.meta.json"), {
    appSlug: input.appSlug, sectionSlug: input.sectionSlug, sourceScenarioId: input.plan.scenario.externalId,
    title: input.plan.scenario.title, generatedAt: new Date().toISOString(), executionEngine: "jira_semantic",
  });
  await writeJsonAtomic(appPaths.caseConfigPath, {
    id: automationId, externalId: input.plan.scenario.externalId, title: input.plan.scenario.title,
    source: "discovery", appSlug: input.appSlug, appConfigPath: appPaths.configPath, createdAt: new Date().toISOString(),
  });
  savePromotedDataManifestSync(path.join(appPaths.caseDir, "promoted-data.json"), buildPromotedDataManifest(input.plan, dataContext));
  try { await fs.rename(candidatePath, appPaths.specPath); }
  catch {
    await fs.rm(appPaths.specPath, { force: true });
    await fs.rename(candidatePath, appPaths.specPath);
  }
  const verificationStatus: "passed" = "passed";

  const now = new Date().toISOString();
  const entry: PromotedAutomationIndexEntry = {
    id: automationId,
    externalId: input.plan.scenario.externalId,
    title: input.plan.scenario.title,
    planPath: appPaths.planPath,
    specPath: appPaths.specPath,
    appSlug: input.appSlug,
    appConfigPath: appPaths.configPath,
    status: verificationStatus === "passed" ? "active" : "spec_failed",
    source: "discovery",
    appProfile: input.appSlug,
    baseUrlHash: appProfile.baseUrlHash,
    createdAt: now,
    updatedAt: now,
    specVerificationStatus: verificationStatus,
    tags: ["jira_semantic", "jira_generated"],
    metadata: { specGeneration: {
      mode: "deterministic", provider: null, model: null, invocations: 0, invocationsConsumed: 0,
      durationMs: 0, usage: { inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, nonCachedInputTokens: null,
        outputTokens: null, reasoningOutputTokens: null, totalPhysicalTokens: null, durationMs: null, credits: null },
      validation: { schema: "passed", structure: "passed", typescript: "skipped", playwrightDiscovery: "skipped",
        semanticCoverage: "passed", functionalExecution: verificationStatus },
      promotionAllowed: verificationStatus === "passed", specsRequested: 1, specsValidated: verificationStatus === "passed" ? 1 : 0,
      specsRejected: verificationStatus === "passed" ? 0 : 1, specWritten: verificationStatus === "passed", errors: [], warnings: [],
    } },
  };
  const appIndex = await loadAutomationIndex(appPaths.indexPath);
  await saveAutomationIndex(upsertAutomationIndexEntry(appIndex, entry), appPaths.indexPath);
  await writeJsonAtomic(appPaths.caseAutomationPath, entry);
  const globalIndexPath = path.resolve("automations/index.json");
  const globalIndex = await loadAutomationIndex(globalIndexPath);
  await saveAutomationIndex(upsertAutomationIndexEntry(globalIndex, entry), globalIndexPath);
  return entry;
}
