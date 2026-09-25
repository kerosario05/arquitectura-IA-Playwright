import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { config as envConfig } from "../config/env";
import { validateExecutionPlan } from "../plans/execution-plan-validator";
import type { ExecutionPlan, ExecutionPlanStep, PlanTarget } from "../types/execution-plan.types";
import type { FullConfig } from "../types/env.types";
import type { PromotedAutomationIndexEntry, PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";
import {
  buildAutomationId,
  determineAutomationStatus
} from "./automation-naming";
import {
  loadAutomationIndex,
  saveAutomationIndex,
  upsertAutomationIndexEntry
} from "./automation-index";
import { generateSpecFromPlan, generateSpecFromPlanWithPolicy } from "./spec-generator";
import { sanitizeText, CANDIDATE_NAVIGATION_HEADROOM_MS } from "./spec-generation-hybrid";
import {
  deriveAppProfile,
  serializeRuntimeConfigForPromotion,
  savePromotedAppConfig,
  buildAppAutomationPaths,
  ensureAppStructure,
  validateAuthFlowDependencies,
  loadPromotedAppConfigSync,
  type AppProfile
} from "./app-profile";
import {
  INTENT_CLASS_OWNERSHIP,
  INTENT_PREFERRED_OWNER,
  SCREEN_TYPE_CLASS_MAP,
  METHOD_INTENT_NAME_MAP,
  METHOD_INTENT_PARAMS,
  type SemanticScreenType,
  type SemanticMethodIntent
} from "../types/pom-ownership";
import {
  loadPageObjectRegistry,
  savePageObjectRegistry,
  ensurePageObjectRegistry,
  registerPageObjectCandidate,
  registerMethodCandidate,
  findCandidatePageObjectByScreenSignature
} from "./page-object-registry";
import { ensureFlowRegistry, registerFlowCandidate, saveFlowRegistry } from "./flow-registry";
import type { PageObjectEntry, PageObjectRegistry } from "../types/page-object.types";
import {
  shouldRunAutoPom,
  runAutoPomPipeline,
  reconcileActivePageObjectMethods,
  type AutoPomDiagnostics
} from "./auto-pom";
import { buildDataContext, type DataContextEntry } from "../data/data-context";
import { buildPromotedDataManifest, savePromotedDataManifestSync } from "../data/promoted-data";
import { validatePromotedSpecRuntimeContract } from "./runtime/promoted-runtime-contract";
import { materializePromotedRuntimeEnv } from "./runtime/promoted-spec-runtime";
import { getSectionSlug, rewritePromotedAuthFlowHelperImport, rewritePromotedRuntimeImport, runHybridSpecGeneration, validatePromotedSpecInternalImports, type SpecGenerationDiagnostics, type SpecGenerationSourceScenario } from "./spec-generation-hybrid";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { compileDeterministicSpec } from "./spec-compiler/deterministic-spec-compiler";
import {
  buildPromotedArtifactIdentity,
  isEligibleForDeterministicRevalidation,
  loadExistingSpecRevalidationContext,
  persistSuccessfulExistingSpecRevalidation,
  promoteExistingVerifiedSpec,
} from "./persisted-spec-revalidation";
import { revalidateExistingSpecDeterministically } from "./existing-spec-revalidation";
import { validatePromotedArtifactForReuse, type PromotedArtifactPhysicalContext } from "./automation-reuse";

interface PromoteInput {
  plan: ExecutionPlan;
  sourcePlanPath?: string;
  lastExecutionResultPath?: string;
  outputRoot?: string;
  source?: "agent_handoff" | "manual" | "rule_based" | "discovery";
  overwrite?: boolean;
  appProfile?: string;
  appProfileObject?: AppProfile;
  appName?: string;
  baseUrl?: string;
  fullConfig?: FullConfig;
  promotionPolicy?: PromotionPolicy;
  inlineDebugMode?: boolean;
  verifySpec?: boolean;
  specVerificationTimeoutMs?: number;
  requirePomRuntime?: boolean;
  sectionSlug?: string;
  sectionId?: string | number;
  sectionName?: string;
  sourceScenario?: SpecGenerationSourceScenario;
  headed?: boolean;
  executionSource?: string;
  skipExistingSpecAdmission?: boolean;
  persistAppConfig?: boolean;
  /**
   * Opt-in only (default false): when the freshly-built SpecExecutionContract has
   * full authority for every required action (compileDeterministicSpec returns
   * zero unsupportedCapabilities and one binding per required action), generate
   * the spec via the deterministic compiler instead of AI, and fail closed
   * (never fall back to AI) if that authority is insufficient. Default-off so
   * existing production behavior for operations/flows the deterministic
   * compiler does not yet cover (select, multi-step POM flows, etc.) is
   * unaffected until explicitly requested.
   */
  useDeterministicSpecCompiler?: boolean;
  /**
   * Scenario-scoped runtime data authority already resolved by the caller (e.g. Discovery's own
   * resolveDataKey, which may include CURRENT_QA_EDIT-sourced overrides) -- never re-resolved
   * here. Structured, with source/lineage preserved, matching case-discovery-workflow.ts's own
   * options.runtimeEntries shape exactly (same DataContextEntry[] type). Takes precedence over
   * static/configured data when building runtimeInputValues for functionalExecution.
   */
  runtimeEntries?: DataContextEntry[];
}

export async function materializePromotionContext(input: {
  plan: ExecutionPlan;
  sourceScenario: SpecGenerationSourceScenario;
  appProfile: AppProfile;
  sectionSlug?: string;
  outputRoot?: string;
}): Promise<{ planPath: string; sourceScenario: unknown; executionContract: unknown }> {
  const automationId = buildAutomationId({ externalId: input.plan.scenario.externalId, caseId: input.plan.scenario.caseId, title: input.plan.scenario.title });
  const paths = buildAppAutomationPaths(input.appProfile, automationId, input.outputRoot, input.sectionSlug);
  await fs.mkdir(path.dirname(paths.planPath), { recursive: true });
  const executionContract = buildSpecExecutionContract(input.plan, input.sourceScenario, { appSlug: input.appProfile.appSlug, sectionSlug: input.sectionSlug });
  const persistedPlan = { ...input.plan, sourceScenario: input.sourceScenario, executionContract };
  await writeFileAtomicWithRetry(paths.planPath, JSON.stringify(persistedPlan, null, 2));
  console.log(`[promotion-context-materialization] caseId=${input.plan.scenario.caseId ?? input.plan.scenario.externalId} sourceScenario=true executionContract=true stoppedBeforeGeneration=true`);
  return { planPath: paths.planPath, sourceScenario: input.sourceScenario, executionContract };
}

const PROMOTION_IO_RETRIES = 3;
const PROMOTION_IO_RETRY_DELAY_MS = 50;

function isTransientFsError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "EMFILE" || code === "ENFILE";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFileAtomicWithRetry(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  for (let attempt = 0; attempt <= PROMOTION_IO_RETRIES; attempt += 1) {
    const tempPath = path.join(dir, `${path.basename(filePath)}.${process.pid}.${Date.now()}.${attempt}.tmp`);
    try {
      await fs.writeFile(tempPath, content, "utf-8");
      await fs.rename(tempPath, filePath).catch(async (error) => {
        if (isTransientFsError(error) || (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST")) {
          await fs.rm(filePath, { force: true }).catch(() => undefined);
          await fs.rename(tempPath, filePath);
          return;
        }
        throw error;
      });
      return;
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      if (isTransientFsError(error) && attempt < PROMOTION_IO_RETRIES) {
        await delay(PROMOTION_IO_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

}

export async function persistFreshPlanForExistingSpecReuse(input: {
  planPath: string;
  plan: ExecutionPlan;
  sourceScenario: SpecGenerationSourceScenario;
  executionContract: Record<string, unknown>;
}): Promise<void> {
  const persistedPlan = {
    ...input.plan,
    sourceScenario: input.sourceScenario,
    executionContract: input.executionContract,
  };
  await writeFileAtomicWithRetry(input.planPath, JSON.stringify(persistedPlan, null, 2));
}

async function readExistingSpecInfo(specPath: string): Promise<{ existed: boolean; hash: string | null; lastModifiedAt: string | null }> {
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(specPath, "utf-8"),
      fs.stat(specPath)
    ]);
    const hash = createHash("sha256").update(content, "utf-8").digest("hex");
    return {
      existed: true,
      hash,
      lastModifiedAt: stat.mtime.toISOString()
    };
  } catch {
    return {
      existed: false,
      hash: null,
      lastModifiedAt: null
    };
  }
}

export type ExistingSpecPreGenerationRouteInput = {
  caseDir: string;
  specPath: string;
  planPath?: string;
  freshPlan?: ExecutionPlan;
  appSlug: string;
  sectionSlug?: string;
  caseId?: number;
  sourceScenario?: SpecGenerationSourceScenario;
  executionContract?: Record<string, unknown>;
  semanticContext?: Parameters<typeof revalidateExistingSpecDeterministically>[0]["semanticContext"];
  dependencies?: {
    loadContext?: typeof loadExistingSpecRevalidationContext;
    isEligible?: typeof isEligibleForDeterministicRevalidation;
    revalidate?: typeof revalidateExistingSpecDeterministically;
    persist?: typeof persistSuccessfulExistingSpecRevalidation;
    promote?: typeof promoteExistingVerifiedSpec;
    persistFreshPlan?: typeof persistFreshPlanForExistingSpecReuse;
    loadAutomation?: (caseDir: string) => Promise<PromotedAutomationIndexEntry>;
    validateAuthority?: typeof validatePromotedArtifactForReuse;
  };
};

export type ExistingSpecPreGenerationRouteResult = {
  handled: boolean;
  promoted: boolean;
  reason?: string;
};

/** Admit a matching physical spec before any deterministic/AI generation occurs. */
export async function tryPromoteExistingSpecBeforeGeneration(
  input: ExistingSpecPreGenerationRouteInput
): Promise<ExistingSpecPreGenerationRouteResult> {
  if (!input.sourceScenario || !input.executionContract || !input.semanticContext) {
    return { handled: false, promoted: false, reason: "current_context_missing" };
  }

  let context;
  const dependencies = input.dependencies ?? {};
  try {
    context = await (dependencies.loadContext ?? loadExistingSpecRevalidationContext)({
      caseDir: input.caseDir,
      appSlug: input.appSlug,
      sectionSlug: input.sectionSlug,
      caseId: input.caseId,
    });
  } catch {
    return { handled: false, promoted: false, reason: "existing_spec_missing" };
  }

  const eligible = (dependencies.isEligible ?? isEligibleForDeterministicRevalidation)({
    previousSpecExisted: true,
    specText: context.specText,
    specPath: context.specPath,
    sourceScenario: input.sourceScenario,
    executionContract: input.executionContract,
    identityValidated: context.identityValidated,
    semanticContext: input.semanticContext,
  });
  if (!eligible) return { handled: false, promoted: false, reason: "existing_spec_not_eligible" };

  const result = await (dependencies.revalidate ?? revalidateExistingSpecDeterministically)({
    specText: context.specText,
    specPath: context.specPath,
    sourceScenario: input.sourceScenario,
    executionContract: input.executionContract as never,
    semanticContext: input.semanticContext,
  });
  if (result.status !== "passed" || !result.allRequiredGatesPassed) {
    return { handled: false, promoted: false, reason: "deterministic_revalidation_failed" };
  }

  const persisted = await (dependencies.persist ?? persistSuccessfulExistingSpecRevalidation)({
    caseDir: input.caseDir,
    appSlug: input.appSlug,
    sectionSlug: input.sectionSlug,
    caseId: input.caseId,
    identityValidated: context.identityValidated,
    specText: context.specText,
    result,
  });
  if (!persisted.persisted) return { handled: false, promoted: false, reason: persisted.reason ?? "revalidation_persistence_failed" };

  const persistFreshPlan = async (): Promise<void> => {
    if (!input.freshPlan || !input.planPath) return;
    await (dependencies.persistFreshPlan ?? persistFreshPlanForExistingSpecReuse)({
      planPath: input.planPath,
      plan: input.freshPlan,
      sourceScenario: input.sourceScenario,
      executionContract: input.executionContract,
    });
  };

  const loadAutomation = dependencies.loadAutomation ?? (async (caseDir: string) =>
    JSON.parse(await fs.readFile(path.join(caseDir, "automation.json"), "utf8")) as PromotedAutomationIndexEntry);
  let automation: PromotedAutomationIndexEntry;
  try {
    automation = await loadAutomation(input.caseDir);
  } catch {
    return { handled: false, promoted: false, reason: "promotion_authority_missing" };
  }
  const physical: PromotedArtifactPhysicalContext = {
    specPath: context.specPath,
    specExists: true,
    specText: context.specText,
    appSlug: input.appSlug,
    sectionSlug: input.sectionSlug ?? "",
    caseId: input.caseId ?? Number.NaN,
  };
  const authority = (dependencies.validateAuthority ?? validatePromotedArtifactForReuse)(automation, physical);
  if (automation.status === "active") {
    if (!authority.valid) return { handled: false, promoted: false, reason: `active_authority_${authority.reason ?? "invalid"}` };
    await persistFreshPlan();
    return { handled: true, promoted: true, reason: "existing_active_revalidated" };
  }

  const promoted = await (dependencies.promote ?? promoteExistingVerifiedSpec)({
    caseDir: input.caseDir,
    appSlug: input.appSlug,
    sectionSlug: input.sectionSlug ?? "default-section",
    caseId: input.caseId ?? Number.NaN,
    specPath: context.specPath,
  });
  if (!promoted.promotionSucceeded) return { handled: false, promoted: false, reason: promoted.reason ?? "existing_promotion_failed" };
  await persistFreshPlan();
  return { handled: true, promoted: true };
}

function assertPromotable(status: string, allowDraft: boolean): void {
  if (status === "needs_data" || status === "needs_discovery" || status === "unsupported") {
    throw new Error(
      `Plan status '${status}' is not eligible for promotion. Only 'validated' plans can be promoted.`
    );
  }
  if (status === "draft" && !allowDraft) {
    throw new Error(
      `Plan status is 'draft'. Use --allow-draft to promote draft plans or resolve required data first.`
    );
  }
}

function ensurePromotedSpecNavigation(specContent: string, plan: ExecutionPlan): string {
  const hasNavigationStep = plan.steps.some((step) => step.action === "navigate");
  if (!hasNavigationStep || /\.goto\s*\(/.test(specContent)) return specContent;

  const navigation = [
    "    const baseUrl = process.env.APP_BASE_URL;",
    "    if (!baseUrl) throw new Error('APP_BASE_URL is required');",
    "    await page.goto(baseUrl);",
    "    await page.waitForLoadState('domcontentloaded');",
    ""
  ].join("\n");
  return specContent.replace(/(\n\s*try\s*\{\n)/, `$1${navigation}`);
}

function ensurePromotedSpecStrategyMarker(
  specContent: string,
  selectedStrategy: "pom" | "inline" | undefined,
): string {
  if (selectedStrategy !== "pom") return specContent;
  if (!specContent.includes("createPromotedSpecRuntime(") || /PROMOTED_SPEC_STRATEGY\s*=/.test(specContent)) {
    return specContent;
  }
  return `export const PROMOTED_SPEC_STRATEGY = "pom_runtime";\n${specContent}`;
}

async function ensureDirectories(paths: {
  caseDir?: string;
  caseEvidenceDir?: string;
  caseRunsDir?: string;
  plansDir: string;
  specsDir: string;
}): Promise<void> {
  if (paths.caseDir) await fs.mkdir(paths.caseDir, { recursive: true });
  if (paths.caseEvidenceDir) await fs.mkdir(paths.caseEvidenceDir, { recursive: true });
  if (paths.caseRunsDir) await fs.mkdir(paths.caseRunsDir, { recursive: true });
  await fs.mkdir(paths.plansDir, { recursive: true });
  await fs.mkdir(paths.specsDir, { recursive: true });
}

export type VerifyPromotedSpecOptions = {
  /**
   * When set, this is authoritative over `playwright.config.ts`'s own `HEADLESS`-env-var
   * default (which defaults to headed — convenient for manual CLI/dev use, wrong for any
   * execution QA Lab starts). Passing `true` forces the spawned Playwright process's
   * `HEADLESS` env var regardless of what the parent process inherited, so a browser window
   * can never appear from a product-initiated run. Leaving it unset preserves the previous
   * CLI behavior (`--verify-promoted-spec` during `discovery:case`/`discovery:preview`),
   * which intentionally follows the ambient config.
   */
  headless?: boolean;
  /** Structured provenance for the launch log — never inferred from context. */
  executionSource?: string;
  scenarioId?: string;
  /**
   * When set, the spawned Playwright process's runtime evidence recorder (promoted-spec-runtime.ts's
   * `initEvidence`) is scoped to THIS run/scenario instead of whatever stale values happened to
   * already sit in the parent process's env. Without this, a reused promoted spec's evidence lands
   * under an unaddressable `runId=undefined` path that no consolidation pass can ever find it under.
   */
  evidenceContext?: {
    runId: string;
    scenarioId: string;
    scenarioTitle: string;
    appSlug: string;
    sectionSlug: string;
  };
  /**
   * The selected scenario's own app/runtime execution context -- required for `verifyPromotedSpec`
   * to launch the spawned Playwright process scoped to the RIGHT app, instead of inheriting
   * whatever APP_SLUG/APP_PROFILE/APP_BASE_URL happened to already sit in the parent (server)
   * process's env. Reuses the SAME authority `npm run test:promoted` and functional execution
   * already use (resolvePromotedExecutionEnv / preparePromotedRuntimeInputs in cli/test-promoted.ts)
   * -- never a second, independent app-config/baseUrl resolution. `EVIDENCE_APP_SLUG` (above) is
   * evidence-pathing metadata only and never substitutes for this.
   */
  appContext?: {
    appSlug: string;
    /** Enables PROMOTED_* runtime-input resolution for this case, when the spec requires any. */
    caseId?: number;
    contextPath?: string;
    /**
     * The selected scenario's OWN current runtime data ("Datos de este escenario" --
     * RecordedScenario.runtimeDataset.resolvedValues, the same CURRENT_QA_EDIT-class authority
     * promoteExecutionPlan's own `runtimeEntries` already takes precedence over static/app-global
     * data with). When present, ALWAYS wins over this app's global/default testData for any key
     * it supplies; the app-global data remains only as a fallback for keys the scenario doesn't
     * carry -- never the reverse.
     */
    scenarioRuntimeValues?: Record<string, string>;
  };
  /**
   * Live sink for the spawned child's stdout/stderr, called per completed line AS the process
   * emits it -- never buffered until exit. Reuses whatever Live Log/SSE channel the caller
   * already has (e.g. jobStore.appendLog); `verifyPromotedSpec` never talks to that channel
   * directly, keeping this module decoupled from server internals. Every line passed here is
   * already redacted (see redactVerifyPromotedSpecOutput) -- never raw child output.
   */
  onOutput?: (event: VerifyPromotedSpecLiveLine) => void;
};

/**
 * Resolves the FULL app/runtime execution env for a promoted spec's child Playwright process,
 * reusing the same resolvers `npm run test:promoted` (src/cli/test-promoted.ts) already uses --
 * never a second, independent app-config/baseUrl resolution path. `appContext` is required for
 * scoping: when omitted, the ambient `baseEnv` is returned unchanged (legacy behavior for callers
 * that don't scope a specific app, e.g. the bare `--verify-promoted-spec` CLI flag). When
 * `appContext` IS provided but carries no usable `appSlug`, this fails closed (throws) rather
 * than silently falling back to whatever project the parent process happened to be configured
 * for. `deps` is injectable so this is testable without touching real app.config files, a
 * database, or spawning a process.
 */
export type ResolveVerifyPromotedSpecAppExecEnvDeps = {
  resolvePromotedExecutionEnv: typeof import("../cli/test-promoted").resolvePromotedExecutionEnv;
  resolvePromotedRuntimeInputKeys: typeof import("../cli/test-promoted").resolvePromotedRuntimeInputKeys;
  preparePromotedRuntimeInputs: typeof import("../cli/test-promoted").preparePromotedRuntimeInputs;
  readSpecSource: (specPath: string) => Promise<string>;
  /**
   * Resolves this app's own key->value runtime data (username/password/testData, with
   * testDataAliases expanded) -- the SAME authority `buildDataContext` + `buildRuntimeInputValues`
   * already provide during promotion (spec-generation-hybrid.ts's functional execution,
   * launchContext.runtimeInputValues), sourced here from the SAME materialized app config
   * `resolvePromotedExecutionEnv` above already loads (loadPromotedAppConfigSync) -- never a
   * second, independent data-resolution path. Generic: returns whatever keys this app's own
   * config/aliases define, never a hardcoded business key.
   */
  resolvePromotedScenarioRuntimeValues: (appSlug: string) => Record<string, string>;
};

function defaultResolvePromotedScenarioRuntimeValues(appSlug: string): Record<string, string> {
  const projectConfig = loadPromotedAppConfigSync({ appSlug });
  if (!projectConfig) return {};
  const minimalConfig = {
    app: {
      username: projectConfig.username,
      password: projectConfig.password,
      extraLoginFields: {},
      testData: projectConfig.testData ?? {},
      testDataAliases: projectConfig.testDataAliases ?? {},
    },
  } as unknown as FullConfig;
  const dataContext = buildDataContext(minimalConfig);
  return buildRuntimeInputValues(dataContext.entries, undefined);
}

async function defaultResolveVerifyPromotedSpecAppExecEnvDeps(): Promise<ResolveVerifyPromotedSpecAppExecEnvDeps> {
  const testPromoted = await import("../cli/test-promoted");
  return {
    resolvePromotedExecutionEnv: testPromoted.resolvePromotedExecutionEnv,
    resolvePromotedRuntimeInputKeys: testPromoted.resolvePromotedRuntimeInputKeys,
    preparePromotedRuntimeInputs: testPromoted.preparePromotedRuntimeInputs,
    readSpecSource: (p) => fs.readFile(p, "utf8"),
    resolvePromotedScenarioRuntimeValues: defaultResolvePromotedScenarioRuntimeValues,
  };
}

/**
 * A compiled promoted spec reads its runtime data as `process.env['PROMOTED_<KEY>']`
 * (deterministic-spec-compiler.ts's own emission shape, materializePromotedRuntimeEnv's naming
 * convention) -- generic scan, never a hardcoded business key name.
 */
function resolveRequiredPromotedEnvKeysFromSource(specSource: string): string[] {
  const matches = specSource.matchAll(/process\.env\[(?:'|")PROMOTED_([A-Z0-9_]+)(?:'|")\]/g);
  return Array.from(new Set(Array.from(matches, (m) => `PROMOTED_${m[1]}`)));
}

export async function resolveVerifyPromotedSpecAppExecEnv(
  baseEnv: NodeJS.ProcessEnv,
  appContext: VerifyPromotedSpecOptions["appContext"],
  specPath: string,
  deps?: ResolveVerifyPromotedSpecAppExecEnvDeps,
): Promise<NodeJS.ProcessEnv> {
  if (!appContext) return baseEnv;
  const appSlug = appContext.appSlug?.trim();
  if (!appSlug) {
    throw new Error(
      "[promoted-runtime-config] appContext.appSlug is required and must not be empty -- refusing to silently fall back to the ambient/default project env",
    );
  }
  const resolvedDeps = deps ?? await defaultResolveVerifyPromotedSpecAppExecEnvDeps();
  const scopedBaseEnv: NodeJS.ProcessEnv = { ...baseEnv, APP_SLUG: appSlug, APP_PROFILE: appSlug };
  let execEnv = await resolvedDeps.resolvePromotedExecutionEnv(scopedBaseEnv, appSlug);
  if (typeof appContext.caseId === "number") {
    const specSource = await resolvedDeps.readSpecSource(specPath).catch(() => "");
    const requiredKeys = resolvedDeps.resolvePromotedRuntimeInputKeys(specSource);
    const runtimeInputs = await resolvedDeps.preparePromotedRuntimeInputs({
      contextPath: appContext.contextPath,
      caseId: appContext.caseId,
      baseEnv: execEnv,
      requiredKeys,
    });
    if (!runtimeInputs.ok) {
      throw new Error(
        `[promoted-runtime-config] missing required runtime input "${runtimeInputs.missingKey}" for appSlug=${appSlug} caseId=${appContext.caseId}`,
      );
    }
    execEnv = runtimeInputs.env;
  }

  // FIRST_LOSS fix (jobId dd76f6cc-76fd-4370-9a7d-c7eee2557bad): the deterministic-compiled
  // spec's own PROMOTED_<KEY> env reads were never populated for reuse-existing -- neither
  // resolvePromotedRuntimeInputKeys (which only recognizes the fixed 3-key auth.* map and
  // requirePromotedData(dataContext, ...) calls, not this naming convention) nor
  // preparePromotedRuntimeInputs (which only ever writes those same 3 fixed env names) can
  // produce it. Scenario-scoped values (SAME app-config authority resolvePromotedExecutionEnv
  // above already loaded) win over any stale value the parent process/spec's own generic env
  // already carried, materialized via the SAME PROMOTED_<KEY> convention the compiler/runtime
  // already share (materializePromotedRuntimeEnv) -- never a second protocol.
  // Precedence (matching promoteExecutionPlan's own runtimeEntries-over-static-data rule):
  // this scenario's OWN current "Datos de este escenario" values ALWAYS win; the app's
  // global/default testData is used only as a fallback for keys the scenario doesn't supply.
  const appGlobalRuntimeValues = resolvedDeps.resolvePromotedScenarioRuntimeValues(appSlug);
  const effectiveRuntimeValues = { ...appGlobalRuntimeValues, ...(appContext.scenarioRuntimeValues ?? {}) };
  execEnv = { ...execEnv, ...materializePromotedRuntimeEnv(effectiveRuntimeValues) };

  const specSourceForRequiredKeys = await resolvedDeps.readSpecSource(specPath).catch(() => "");
  const requiredPromotedEnvKeys = resolveRequiredPromotedEnvKeysFromSource(specSourceForRequiredKeys);
  const stillMissing = requiredPromotedEnvKeys.filter((envName) => !execEnv[envName] || !execEnv[envName]!.trim());
  if (stillMissing.length > 0) {
    throw new Error(
      `[promoted-runtime-config] missing required runtime value(s) for appSlug=${appSlug}: ${stillMissing.join(", ")} `
      + `(present in the compiled spec but not resolvable from this app's own runtime data authority)`,
    );
  }

  return execEnv;
}

/**
 * Builds the child process env for `verifyPromotedSpec`'s spawned Playwright run. Pulled out as
 * a pure function so the exact env produced for a given set of options is hermetically testable
 * without spawning a process — and so it's obvious this never writes to `process.env` itself: it
 * only ever returns `process.env` unmodified, or a fresh copy carrying the extra keys.
 */
export function buildVerifyPromotedSpecExecEnv(options: VerifyPromotedSpecOptions): NodeJS.ProcessEnv {
  if (options.headless === undefined && !options.evidenceContext) return process.env;
  const execEnv: NodeJS.ProcessEnv = { ...process.env };
  if (options.headless !== undefined) {
    execEnv.HEADLESS = String(options.headless);
  }
  if (options.evidenceContext) {
    const { runId, scenarioId, scenarioTitle, appSlug, sectionSlug } = options.evidenceContext;
    execEnv.EVIDENCE_RUN_ID = runId;
    execEnv.SCENARIO_ID = scenarioId;
    execEnv.SCENARIO_TITLE = scenarioTitle;
    execEnv.EVIDENCE_APP_SLUG = appSlug;
    execEnv.EVIDENCE_SECTION_SLUG = sectionSlug;
  }
  return execEnv;
}

/** One completed line of a spawned promoted-spec child's stdout/stderr, emitted live -- before
 * the process exits, not buffered until close. */
export type VerifyPromotedSpecLiveLine = { stream: "stdout" | "stderr"; line: string };

export type VerifyPromotedSpecExecAsync = (
  cmd: string,
  options: { timeout: number; cwd: string; env: NodeJS.ProcessEnv; onLine?: (event: VerifyPromotedSpecLiveLine) => void },
) => Promise<{ stdout: string; stderr: string }>;

/** Accumulates chunks and emits only complete lines, buffering any trailing partial line across
 * `data` events; `flush()` emits whatever partial line remains once the stream closes. */
function createLineEmitter(onLine: (line: string) => void) {
  let carry = "";
  return {
    push(chunk: string): void {
      carry += chunk;
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    },
    flush(): void {
      if (carry.length > 0) {
        onLine(carry);
        carry = "";
      }
    },
  };
}

/**
 * The single spawn -> stream -> collect -> timeout/exit -> result/error path for
 * `verifyPromotedSpec`'s child Playwright process. Streams `onLine` events AS the child emits
 * them (never waits for exit), while still accumulating the full stdout/stderr so the final
 * pass/fail diagnostic (below) loses nothing -- same command string, same env/cwd/timeout, same
 * exit-code/signal-driven resolve-vs-reject semantics the previous buffered `exec`-based launcher
 * had, so callers observe an identical result shape either way.
 */
export async function defaultVerifyPromotedSpecExecAsync(
  cmd: string,
  options: { timeout: number; cwd: string; env: NodeJS.ProcessEnv; onLine?: (event: VerifyPromotedSpecLiveLine) => void },
): Promise<{ stdout: string; stderr: string }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, cwd: options.cwd, env: options.env });
    let stdout = "";
    let stderr = "";
    const stdoutEmitter = createLineEmitter((line) => options.onLine?.({ stream: "stdout", line }));
    const stderrEmitter = createLineEmitter((line) => options.onLine?.({ stream: "stderr", line }));
    // Single settlement authority: only `close` (or `error`, for a spawn-level failure) ever
    // resolves/rejects this promise. The watchdog below only ever calls `child.kill()` -- it
    // never settles the promise itself -- so a timeout can only ever influence the OUTCOME
    // `close` later observes (a non-zero code / kill signal), never race it.
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeout);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      stdoutEmitter.push(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      stderrEmitter.push(text);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdoutEmitter.flush();
      stderrEmitter.flush();
      reject(Object.assign(err, { stdout, stderr, timedOut }));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdoutEmitter.flush();
      stderrEmitter.flush();
      if (code === 0 && !timedOut) {
        resolve({ stdout, stderr });
      } else if (timedOut) {
        // A real watchdog expiry, distinguished from every other non-zero-exit cause -- never
        // reported as a generic "Command failed", per invariant.
        reject(Object.assign(
          new Error(`Promoted spec verification timed out after ${options.timeout}ms: ${cmd}`),
          { stdout, stderr, code: code ?? undefined, signal: signal ?? undefined, timedOut: true },
        ));
      } else {
        reject(Object.assign(new Error(`Command failed: ${cmd}`), { stdout, stderr, code: code ?? undefined, signal: signal ?? undefined, timedOut: false }));
      }
    });
  });
}

export async function verifyPromotedSpec(
  specPath: string,
  timeoutMs: number = 90000,
  options: VerifyPromotedSpecOptions = {},
  // Injectable so this is hermetically testable without spawning a real process or touching a
  // real Playwright installation -- production callers always get the real spawned exec.
  execAsync: VerifyPromotedSpecExecAsync = defaultVerifyPromotedSpecExecAsync,
): Promise<{
  status: "passed" | "failed" | "skipped";
  error?: string;
  tracePath?: string;
  screenshotPath?: string;
}> {
  // Hoisted so the catch block below can redact using the SAME env this run actually launched
  // with, even though the failure happened after it was built inside the try block.
  let execEnv: NodeJS.ProcessEnv = process.env;
  try {
    const specPathNormalized = specPath.replace(/\\/g, "/");
    const cmd = `npx playwright test "${specPathNormalized}" --config=playwright.config.ts --timeout=${timeoutMs}`;
    console.log(`[promote-plan] Verifying promoted spec: ${cmd}`);
    if (options.headless !== undefined) {
      console.log(`[promoted-runtime-launch] executionSource=${options.executionSource ?? "unknown"} headless=${options.headless} specPath=${specPathNormalized} scenarioId=${options.scenarioId ?? "unknown"}`);
    }

    const baseExecEnv = buildVerifyPromotedSpecExecEnv(options);
    execEnv = await resolveVerifyPromotedSpecAppExecEnv(baseExecEnv, options.appContext, specPathNormalized);
    if (options.appContext) {
      console.log(`[promoted-runtime-config] reuseAppContext appSlug=${options.appContext.appSlug} appSlugResolved=${execEnv.APP_SLUG} appProfileResolved=${execEnv.APP_PROFILE} baseUrlResolved=${execEnv.APP_BASE_URL ?? "none"}`);
    }
    const { stdout, stderr } = await execAsync(cmd, {
      // FIRST_LOSS fix (jobId 243c3a7e-19e5-4b50-9eb6-120d3cfa1486): `timeoutMs` here is
      // Playwright's own PER-TEST `--timeout`, never the total process budget -- startup,
      // evidence capture, and teardown add real overhead on top of it (physically observed: a
      // spec that itself completed and printed "1 passed" still took 2.1m wall-clock, exceeding
      // the previous hardcoded `+30000` external watchdog and getting killed mid-teardown).
      // Reuses the SAME lifecycle-headroom authority spec-generation-hybrid.ts's own functional
      // execution already documents for this exact class of overhead
      // (CANDIDATE_NAVIGATION_HEADROOM_MS) instead of a second arbitrary number.
      timeout: timeoutMs + CANDIDATE_NAVIGATION_HEADROOM_MS,
      cwd: process.cwd(),
      env: execEnv,
      onLine: options.onOutput
        ? (event) => options.onOutput!({ stream: event.stream, line: redactVerifyPromotedSpecOutput(event.line, execEnv) })
        : undefined,
    });

    if (stderr && !stderr.includes("passed")) {
      console.warn(`[promote-plan] Spec verification warnings: ${stderr}`);
    }

    console.log(`[promote-plan] Spec verification passed`);
    return { status: "passed" };
  } catch (error: any) {
    // FIRST_LOSS fix (jobId db4842b6-ed3a-440b-9aa1-49d4f423fbca): execAsync's rejection here
    // carries the SAME rich `stdout`/`stderr`/`code`/`signal` node:child_process always attaches
    // to an ExecException -- only `error.message` ("Command failed: ...") was ever read, so the
    // real Playwright failure (first step, runtime error) was silently discarded before it could
    // reach any log a reuse-existing job's caller could see. Purely diagnostic: does not change
    // what caused the spec to fail, only makes the existing failure observable.
    const diagnosticStdout = redactVerifyPromotedSpecOutput(typeof error.stdout === "string" ? error.stdout : "", execEnv);
    const diagnosticStderr = redactVerifyPromotedSpecOutput(typeof error.stderr === "string" ? error.stderr : "", execEnv);
    const exitCode = typeof error.code === "number" ? error.code : undefined;
    const signal = typeof error.signal === "string" ? error.signal : undefined;
    const timedOut = error.timedOut === true;
    console.error(
      `[promote-plan] Spec verification failed diagnostics exitCode=${exitCode ?? "none"} signal=${signal ?? "none"} timedOut=${timedOut} `
      + `stdoutLength=${diagnosticStdout.length} stderrLength=${diagnosticStderr.length}`
    );
    if (diagnosticStdout) console.error(`[promote-plan] child stdout:\n${diagnosticStdout}`);
    if (diagnosticStderr) console.error(`[promote-plan] child stderr:\n${diagnosticStderr}`);

    const baseMessage = typeof error.message === "string" && error.message ? error.message : String(error);
    const errorMsg = redactVerifyPromotedSpecOutput(
      [baseMessage, diagnosticStdout, diagnosticStderr].filter(Boolean).join("\n"),
      execEnv,
    ) || baseMessage;
    console.error(`[promote-plan] Spec verification failed: ${errorMsg}`);

    const traceMatch = errorMsg.match(/(.*trace\.zip)/);
    const screenshotMatch = errorMsg.match(/(.*test-failed.*\.png)/);

    return {
      status: "failed",
      error: errorMsg,
      tracePath: traceMatch ? traceMatch[1] : undefined,
      screenshotPath: screenshotMatch ? screenshotMatch[1] : undefined
    };
  }
}

/**
 * Redacts a spawned Playwright process's stdout/stderr before it ever reaches a log: first a
 * value-based scrub of the SPECIFIC env values this run's child could have echoed back
 * (APP_USERNAME/APP_PASSWORD/any PROMOTED_* runtime input -- exactly what `execEnv` carries,
 * never a guess), then the same pattern-based `sanitizeText` CORE already uses for generated
 * spec content (api_key/password/secret/token/otp literals, Bearer/Basic auth headers) -- never
 * a second, parallel redaction scheme.
 */
function redactVerifyPromotedSpecOutput(text: string, execEnv: NodeJS.ProcessEnv): string {
  if (!text) return text;
  let redacted = text;
  const sensitiveKeys = Object.keys(execEnv).filter(
    (key) => key === "APP_USERNAME" || key === "APP_PASSWORD" || key.startsWith("PROMOTED_"),
  );
  for (const key of sensitiveKeys) {
    const value = execEnv[key];
    if (typeof value === "string" && value.trim().length >= 3) {
      redacted = redacted.split(value).join("[REDACTED]");
    }
  }
  return sanitizeText(redacted);
}

function deriveScreenSignatureFromPlan(plan: ExecutionPlan): string {
  const caseId = plan.scenario.caseId ?? plan.scenario.externalId ?? "unknown";
  const titleSlug = plan.scenario.title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
  return `screen:c${caseId}-${titleSlug}`;
}

const SCREEN_TYPE_KEYWORDS: Record<string, SemanticScreenType> = {
  "iniciar sesion": "login",
  "iniciar sesión": "login",
  home: "home",
  inicio: "home",
  principal: "home",
  dashboard: "home",
  iniciar: "home",
  start: "home",
  menu: "main_menu",
  navegacion: "main_menu",
  "informacion de productos": "product_information",
  "información de productos": "product_information",
  "product information": "product_information",
  catalogo: "product_list",
  listado: "product_list",
  lista: "product_list",
  list: "product_list",
  "tarjeta de credito": "product_list",
  "tarjeta de crédito": "product_list",
  visa: "product_list",
  prestamo: "product_list",
  producto: "product_list",
  product: "product_list",
  categoria: "category",
  category: "category",
  tarjetas: "category",
  prestamos: "category",
  cuentas: "category",
  creditos: "category",
  detalle: "product_detail",
  detail: "product_detail",
  "detalle de": "product_detail",
  info: "product_detail",
  seleccion: "selection",
  selection: "selection",
  escoger: "selection",
  elegir: "selection",
  formulario: "form",
  form: "form",
  registro: "form",
  register: "form",
  confirmacion: "confirmation",
  confirmation: "confirmation",
  exito: "confirmation",
  success: "confirmation",
  login: "login",
  auth: "login",
  otp: "otp",
  codigo: "otp",
  code: "otp",
  verificacion: "otp",
  verification: "otp"
};

const METHOD_INTENT_KEYWORDS: Record<string, SemanticMethodIntent> = {
  navigate: "open_home",
  "app_base_url": "open_home",
  iniciar: "start_session",
  start: "start_session",
  login: "start_session",
  "informacion de productos": "open_product_information",
  "información de productos": "open_product_information",
  "product information": "open_product_information",
  tarjetas: "select_category",
  prestamos: "select_category",
  cuentas: "select_category",
  categoria: "select_category",
  category: "select_category",
  "tarjeta de credito": "select_product",
  "tarjeta de crédito": "select_product",
  visa: "select_product",
  prestamo: "select_product",
  solicitar: "click_primary_action",
  "solicitar tarjeta": "click_primary_action",
  apply: "click_primary_action",
  request: "click_primary_action",
  detalle: "expect_loaded",
  detail: "expect_loaded",
  validar: "expect_loaded",
  verificar: "expect_loaded",
  comprobar: "expect_loaded",
  expect: "expect_loaded",
  visible: "expect_loaded",
  fill: "fill_form_field",
  escribir: "fill_form_field",
  ingresar: "fill_form_field",
  completar: "fill_form_field",
  producto: "select_product",
  product: "select_product",
  submit: "submit_form",
  enviar: "submit_form",
  confirmar: "confirm_action",
  confirm: "confirm_action",
  pay: "confirm_action",
  pagar: "confirm_action"
};

function normalizeSemanticText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getSemanticStepText(step: ExecutionPlanStep): string {
  const target = step.target && typeof step.target === "object"
    ? `${step.target.value ?? ""} ${step.target.name ?? ""} ${step.target.role ?? ""}`
    : "";
  return normalizeSemanticText(`${target} ${step.description ?? ""} ${step.action}`);
}

function isUsernameSemanticTarget(text: string): boolean {
  return text.includes("username") || text.includes("usuario");
}

function isPasswordSemanticTarget(text: string): boolean {
  return text.includes("password") || text.includes("contrasena");
}

function isLoginSemanticTrigger(text: string): boolean {
  return text.includes("log in") || text.includes("login") || text.includes("iniciar sesion");
}

function hasPriorLoginSemanticEvidence(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[]): boolean {
  const currentIndex = allSteps.indexOf(step);
  if (currentIndex <= 0) return false;
  return allSteps.slice(0, currentIndex).some((candidate) => {
    const text = getSemanticStepText(candidate);
    return (candidate.action === "fill" || candidate.action.startsWith("assert"))
      && (isUsernameSemanticTarget(text) || isPasswordSemanticTarget(text));
  });
}

function isFirstVisibleSemanticSelection(text: string): boolean {
  return /\b(primer[ao]?\s+(producto|item|registro|card|tarjeta|fila)|primera?\s+(tarjeta|card|fila)|first\s+visible\s+(item|product|card|row))\b/i.test(text);
}

function deriveFirstVisibleSemanticIntent(text: string): SemanticMethodIntent {
  if (/\b(fila|row)\b/i.test(text)) return "select_first_visible_row";
  if (/\b(tarjeta|card)\b/i.test(text)) return "select_first_visible_card";
  if (/\b(producto|product)\b/i.test(text)) return "select_first_visible_product";
  return "select_first_visible_item";
}

function classifyScreenType(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[]): SemanticScreenType {
  const target = step.target && typeof step.target === "object"
    ? (step.target.value ?? step.target.name ?? step.target.role ?? "").toLowerCase()
    : "";
  const action = step.action.toLowerCase();
  const description = (step.description ?? "").toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";

  const combinedText = `${target} ${action} ${description} ${recoveredText} ${semanticRelation}`;

  for (const [keyword, screenType] of Object.entries(SCREEN_TYPE_KEYWORDS)) {
    if (combinedText.includes(keyword)) {
      return screenType;
    }
  }

  if (action === "navigate" || target.includes("base_url") || target.includes("app_base")) {
    return "home";
  }

  if (action === "login" || action === "auth") {
    return "login";
  }

  if (isLoginSemanticTrigger(normalizeSemanticText(combinedText)) || isUsernameSemanticTarget(normalizeSemanticText(combinedText)) || isPasswordSemanticTarget(normalizeSemanticText(combinedText))) {
    return "login";
  }

  if (semanticRelation === "parent_category" || semanticRelation === "category") {
    return "category";
  }

  if (action.startsWith("assert") || action.includes("valid") || action.includes("expect")) {
    return "product_detail";
  }

  if (action === "click" || action === "select") {
    return "product_list";
  }

  if (action === "fill") {
    return "form";
  }

  return "unknown";
}

function classifyMethodIntent(step: ExecutionPlanStep, screenType: SemanticScreenType, allSteps: ExecutionPlanStep[]): SemanticMethodIntent {
  const target = step.target && typeof step.target === "object"
    ? (step.target.value ?? step.target.name ?? step.target.role ?? "").toLowerCase()
    : "";
  const action = step.action.toLowerCase();
  const description = (step.description ?? "").toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";
  const normalizedText = getSemanticStepText(step);

  if (action.startsWith("assert")) {
    if (isUsernameSemanticTarget(normalizedText) || isPasswordSemanticTarget(normalizedText)) return "expect_login_form";
    if (normalizedText.includes("welcome") || normalizedText.includes("logout") || normalizedText.includes("cerrar sesion")) return "expect_logged_in";
    return "expect_loaded";
  }

  if (action === "fill") {
    if (isUsernameSemanticTarget(normalizedText)) return "fill_username";
    if (isPasswordSemanticTarget(normalizedText)) return "fill_password";
    return "fill_form_field";
  }

  if ((action === "click" || action === "select") && isLoginSemanticTrigger(normalizedText)) {
    return hasPriorLoginSemanticEvidence(step, allSteps) ? "submit_login" : "open_login_modal";
  }

  if ((action === "click" || action === "select") && isFirstVisibleSemanticSelection(normalizedText)) {
    return deriveFirstVisibleSemanticIntent(normalizedText);
  }

  const combinedText = normalizeSemanticText(`${target} ${action} ${description} ${recoveredText} ${semanticRelation}`);

  for (const [keyword, intent] of Object.entries(METHOD_INTENT_KEYWORDS)) {
    if (combinedText.includes(keyword)) {
      return intent;
    }
  }

  if (action === "navigate") return "open_home";
  if (action === "login") return "start_session";
  if (action.startsWith("assert")) return "expect_loaded";
  if (action === "click" || action === "select") {
    if (screenType === "login") return hasPriorLoginSemanticEvidence(step, allSteps) ? "submit_login" : "open_login_modal";
    if (screenType === "category") return "select_category";
    if (screenType === "product_list") return "select_product";
    if (screenType === "home") return "click_primary_action";
    return "click_primary_action";
  }

  return "unknown";
}

function deriveSemanticScreenType(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[]): SemanticScreenType {
  return classifyScreenType(step, allSteps);
}

function deriveSemanticMethodIntent(step: ExecutionPlanStep, screenType: SemanticScreenType): SemanticMethodIntent {
  return classifyMethodIntent(step, screenType, []);
}

function derivePageObjectClassNameFromScreenType(screenType: SemanticScreenType): string {
  return SCREEN_TYPE_CLASS_MAP[screenType] ?? "GenericPage";
}

function deriveMethodNameFromIntent(intent: SemanticMethodIntent): string {
  return METHOD_INTENT_NAME_MAP[intent] ?? "executeAction";
}

function deriveMethodParameters(intent: SemanticMethodIntent): string[] {
  return METHOD_INTENT_PARAMS[intent] ?? [];
}

function deriveScreenSignatureFromScreenType(screenType: SemanticScreenType, appSlug: string): string {
  return `screen:${appSlug}-${screenType}`;
}

async function registerPOMCandidatesForBlockedPromotion(
  plan: ExecutionPlan,
  automationId: string,
  appProfile: AppProfile,
  outputRoot: string | undefined,
  pomStatus: POMPromotionStatus | undefined,
  specResultMissingMethods: string[]
): Promise<{ pomCandidatesRegistered: number }> {
  if (pomStatus !== "needs_page_object" && pomStatus !== "needs_page_method") {
    return { pomCandidatesRegistered: 0 };
  }

  const registry = await ensurePageObjectRegistry(appProfile, outputRoot);
  const flowReg = await ensureFlowRegistry(appProfile, outputRoot);

  let candidatesRegistered = 0;
  const sourcePlanId = automationId;

  const nonNavigationSteps = plan.steps.filter((s) =>
    s.action !== "navigate" && s.action !== "login"
  );

  type RoutedMethod = {
    name: string;
    intent: string;
    parameters: string[];
    sensitive: boolean;
    confidence: number;
    sourceActionId: string;
    ownerClassName: string;
    screenSignature: string;
  };

  const routedMethods: RoutedMethod[] = [];

  for (const step of nonNavigationSteps) {
    const screenType = deriveSemanticScreenType(step, plan.steps);
    const intent = classifyMethodIntent(step, screenType, plan.steps);
    const recoveryMeta = (step as any).recoveryMetadata;

    const ownerClassName = INTENT_PREFERRED_OWNER[intent] ?? SCREEN_TYPE_CLASS_MAP[screenType] ?? "GenericPage";
    const screenSignature = `screen:${appProfile.appSlug}-${screenType}`;

    routedMethods.push({
      name: deriveMethodNameFromIntent(intent),
      intent,
      parameters: deriveMethodParameters(intent),
      sensitive: step.action === "fill" && step.valueKey !== undefined,
      confidence: recoveryMeta?.score ?? 0.5,
      sourceActionId: `${sourcePlanId}-step-${step.index}`,
      ownerClassName,
      screenSignature
    });
  }

  for (const step of nonNavigationSteps) {
    if (step.action.startsWith("assert")) {
      const screenType = deriveSemanticScreenType(step, plan.steps);
      const detailScreenType: SemanticScreenType = screenType === "product_detail" ? screenType : "product_detail";
      const intent: SemanticMethodIntent = "expect_loaded";
      const recoveryMeta = (step as any).recoveryMetadata;

      const ownerClassName = INTENT_PREFERRED_OWNER[intent] ?? SCREEN_TYPE_CLASS_MAP[detailScreenType] ?? "ProductDetailPage";
      const screenSignature = `screen:${appProfile.appSlug}-${detailScreenType}`;

      routedMethods.push({
        name: deriveMethodNameFromIntent(intent),
        intent,
        parameters: deriveMethodParameters(intent),
        sensitive: false,
        confidence: recoveryMeta?.score ?? 0.5,
        sourceActionId: `${sourcePlanId}-step-${step.index}`,
        ownerClassName,
        screenSignature
      });
    }
  }

  const methodsByOwner = new Map<string, RoutedMethod[]>();
  for (const method of routedMethods) {
    const existing = methodsByOwner.get(method.ownerClassName) ?? [];
    existing.push(method);
    methodsByOwner.set(method.ownerClassName, existing);
  }

  for (const [ownerClassName, methods] of methodsByOwner.entries()) {
    if (ownerClassName === "OtpPage") continue;

    const primaryScreenType = Object.entries(SCREEN_TYPE_CLASS_MAP).find(
      ([, cls]) => cls === ownerClassName
    )?.[0] as SemanticScreenType | undefined;

    const screenSignature = primaryScreenType
      ? `screen:${appProfile.appSlug}-${primaryScreenType}`
      : `screen:${appProfile.appSlug}-${ownerClassName.toLowerCase().replace(/page$/, "")}`;

    let existingPO = registry.pageObjects.find((po) => po.className === ownerClassName);

    if (!existingPO) {
      existingPO = registry.pageObjects.find((po) => po.screenSignature === screenSignature);
    }

    const uniqueMethods = new Map<string, RoutedMethod>();
    for (const m of methods) {
      if (!uniqueMethods.has(m.intent)) {
        uniqueMethods.set(m.intent, m);
      }
    }

    if (!existingPO && uniqueMethods.size > 0) {
      const regResult = registerPageObjectCandidate(registry, {
        name: ownerClassName.replace("Page", ""),
        className: ownerClassName,
        screenSignature,
        confidence: 0.5,
        sourcePlanId,
        methods: Array.from(uniqueMethods.values()).map((m) => ({
          name: m.name,
          intent: m.intent,
          parameters: m.parameters
        }))
      });

      if (regResult.created) {
        candidatesRegistered += 1;
      }

      existingPO = registry.pageObjects.find((po) => po.className === ownerClassName);
    }

    if (existingPO) {
      for (const m of uniqueMethods.values()) {
        registerMethodCandidate(registry, existingPO.id, {
          name: m.name,
          intent: m.intent,
          parameters: m.parameters,
          sensitive: m.sensitive,
          confidence: m.confidence,
          sourceActionId: m.sourceActionId
        });
      }
    }
  }

  const flowSteps = plan.steps.map((s) => {
    const screenType = deriveSemanticScreenType(s, plan.steps);
    const intent = classifyMethodIntent(s, screenType, plan.steps);
    const methodName = deriveMethodNameFromIntent(intent);
    const className = derivePageObjectClassNameFromScreenType(screenType);

    return {
      action: s.action,
      target: s.target && typeof s.target === "object" ? (s.target.value ?? "") : "",
      pageObjectId: className,
      methodName
    };
  });

  const flowName = plan.scenario.title.substring(0, 50);
  await registerFlowCandidate(flowReg, {
    name: flowName,
    steps: flowSteps,
    requiredDataKeys: plan.requiredData.filter((d) => d.required).map((d) => d.key),
    confidence: 0.5
  });

  if (pomStatus === "needs_page_method" && specResultMissingMethods.length > 0) {
    const skipIntents: string[] = [];
    
    for (const missingMethod of specResultMissingMethods) {
      const derivedIntentMatch = missingMethod.match(/derivedIntent="([^"]+)"/);
      const intent = derivedIntentMatch ? derivedIntentMatch[1] : missingMethod.trim();
      
      // Skip login-related intents
      if (skipIntents.includes(intent)) continue;

      // Always use INTENT_PREFERRED_OWNER for consistency, don't trust stale expectedOwner from missing method string
      const ownerClassName = INTENT_PREFERRED_OWNER[intent as SemanticMethodIntent] ?? "GenericPage";

      let ownerPO = registry.pageObjects.find((po) => po.className === ownerClassName);

      if (!ownerPO) {
        ownerPO = registry.pageObjects.find((po) => po.className === "ProductListPage" && po.status === "active");
      }

      if (!ownerPO && registry.pageObjects.length > 0) {
        ownerPO = registry.pageObjects.find((po) => po.status === "candidate") ?? registry.pageObjects[0];
      }

      if (ownerPO) {
        const methodName = deriveMethodNameFromIntent(intent as SemanticMethodIntent);
        registerMethodCandidate(registry, ownerPO.id, {
          name: methodName,
          intent,
          parameters: deriveMethodParameters(intent as SemanticMethodIntent),
          confidence: 0.5,
          sourceActionId: `${sourcePlanId}-missing-${intent}`
        });
      }
    }
  }

  await savePageObjectRegistry(registry, appProfile, outputRoot);
  await saveFlowRegistry(flowReg, appProfile, outputRoot);

  return { pomCandidatesRegistered: candidatesRegistered };
}

/**
 * Pure precedence merge for already-resolved runtime input authority. Never resolves data
 * itself -- both inputs are already-resolved entries. Scenario-scoped runtimeEntries (which may
 * carry CURRENT_QA_EDIT-sourced overrides from the caller's own resolver, e.g. Discovery) win
 * over static/configured dataContextEntries for the same key -- the same precedence Discovery's
 * own resolveDataKey already gives runtimeEntries over configured data.
 */
export function buildRuntimeInputValues(
  dataContextEntries: DataContextEntry[],
  runtimeEntries: DataContextEntry[] | undefined,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      dataContextEntries
        .filter((entry) => entry.value.trim().length > 0)
        .map((entry) => [entry.key, entry.value])
    ),
    ...Object.fromEntries(
      (runtimeEntries ?? [])
        .filter((entry) => typeof entry.value === "string" && entry.value.trim().length > 0)
        .map((entry) => [entry.key, entry.value])
    ),
  };
}

export async function promoteExecutionPlan(
  input: PromoteInput,
  allowDraft = false,
  metadata?: PromotedAutomationIndexEntry["metadata"]
): Promise<PromotedAutomationIndexEntry> {
  const plan = input.plan;
  // A persisted plan is itself an authoritative promotion input.  The CLI
  // commonly reloads only `plan.json`, so do not silently fall back to the
  // reduced execution-plan shape when the caller omits sourceScenario.
  const authoritativeSourceScenario = input.sourceScenario
    ?? (plan as ExecutionPlan & { sourceScenario?: SpecGenerationSourceScenario }).sourceScenario;

  const validation = validateExecutionPlan(plan);

  if (!validation.valid) {
    const errors = validation.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid execution plan: ${errors || "unknown validation errors"}`);
  }

  const status = plan.status;

  if (status !== "validated") {
    assertPromotable(status, allowDraft);
  }

  const automationId = buildAutomationId({
    externalId: plan.scenario.externalId,
    caseId: plan.scenario.caseId,
    title: plan.scenario.title
  });

  const runtimeConfig = input.fullConfig;

  let appProfile: AppProfile;
  if (input.appProfileObject) {
    appProfile = input.appProfileObject;
  } else {
    appProfile = deriveAppProfile({
      appProfile: input.appProfile ?? runtimeConfig?.app.appProfile,
      appName: input.appName ?? runtimeConfig?.app.name,
      baseUrl: input.baseUrl ?? runtimeConfig?.app.baseUrl
    });
  }
  console.log(`[promote] Using appSlug=${appProfile.appSlug}`);
  
  // Determine sectionSlug from input. Normalized once, here, upstream of every consumer in this
  // scope (buildAppAutomationPaths, ensureAppStructure, and -- critically -- the deterministic
  // branch's buildSpecExecutionContract call below) so they all observe the same value instead of
  // each applying their own default independently. Reuses the existing, already-established
  // default policy (spec-generation-hybrid.ts's getSectionSlug) rather than inventing a second one.
  const sectionSlug = getSectionSlug(input.sectionSlug);
  if (input.sectionSlug?.trim()) {
    console.log(`[promote] Using sectionSlug=${sectionSlug}`);
  }

  const appPaths = buildAppAutomationPaths(appProfile, automationId, input.outputRoot, sectionSlug);
  const promotionPolicy = input.promotionPolicy;

  const planHasAuthConsumedSteps = plan.steps.some(s => {
    const desc = (s.description ?? "").toLowerCase();
    return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
  });

  await ensureAppStructure(appPaths.appDir, sectionSlug);
  if (!appPaths.planPath || !appPaths.specPath) {
    throw new Error("Unable to resolve promoted automation paths.");
  }

  if (planHasAuthConsumedSteps) {
    const authValidation = validateAuthFlowDependencies(appPaths.appDir);
    if (!authValidation.valid) {
      throw new Error(
        `AuthFlow is required but dependencies are missing: ${authValidation.missing.join(", ")}. ` +
        `Run ensureAppStructure or copy framework files from default app.`
      );
    }
  }

  try {
    await fs.access(appPaths.planPath);
    if (!input.overwrite) {
      throw new Error(
        `Automation '${automationId}' already exists at '${appPaths.planPath}'. Use --overwrite to replace.`
      );
    }
  } catch (err) {
    if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
      throw err;
    }
  }

  let wasOverwritten = false;
  let previousAutomationPath: string | undefined;
  let previousStatus: string | undefined;

  if (input.overwrite) {
    try {
      await fs.access(appPaths.planPath);
      wasOverwritten = true;
      previousAutomationPath = appPaths.planPath;

      const appDirPathsForLoad = buildAppAutomationPaths(appProfile, undefined, input.outputRoot);
      try {
        const existingAppIndex = await loadAutomationIndex(appDirPathsForLoad.indexPath);
        const existingEntry = existingAppIndex.automations.find((a) => a.id === automationId);
        if (existingEntry) {
          previousStatus = existingEntry.status;
        }
      } catch {
        // Index may not exist or be unreadable, continue without previous status
      }
    } catch {
      // Automation does not exist, nothing to overwrite
    }
  }

  await ensureDirectories(appPaths);

  // Write case.meta.json with section and app metadata
  if (appPaths.caseDir) {
    const caseMeta = {
      appSlug: appProfile.appSlug,
      sectionSlug: sectionSlug ?? "default-section",
      sectionName: input.sectionName,
      sectionId: input.sectionId,
      sourceScenarioId: plan.scenario.externalId,
      testRailCaseId: plan.scenario.caseId ?? input.sectionId,
      generatedAt: new Date().toISOString(),
      title: plan.scenario.title,
    };
    await writeFileAtomicWithRetry(
      path.join(appPaths.caseDir, "case.meta.json"),
      JSON.stringify(caseMeta, null, 2)
    );
  }

  // Already-resolved runtime input authority the promotion pipeline holds -- computed once,
  // reused as-is by the functionalExecution child env below. Never re-resolved downstream; never
  // logged (see materializePromotedRuntimeEnv). input.runtimeEntries (scenario-scoped, may carry
  // CURRENT_QA_EDIT-sourced overrides from the caller's own resolver, e.g. Discovery) takes
  // precedence over static/configured dataContext entries for the same key -- same precedence
  // Discovery's own resolveDataKey already gives runtimeEntries over configured data.
  const runtimeForData = input.fullConfig ?? envConfig;
  const dataContext = buildDataContext(runtimeForData);
  const runtimeInputValues = buildRuntimeInputValues(dataContext.entries, input.runtimeEntries);
  if (appPaths.caseDir) {
    const promotedDataManifest = buildPromotedDataManifest(plan, dataContext);
    savePromotedDataManifestSync(path.join(appPaths.caseDir, "promoted-data.json"), promotedDataManifest);
  }

  // Existing physical specs are admitted before generation. The contract and
  // semantic context here are rebuilt from the current discovery inputs.
  if (appPaths.caseDir && authoritativeSourceScenario && !input.skipExistingSpecAdmission) {
    const currentRegistry = promotionPolicy?.specMode === "page-object"
      ? await loadPageObjectRegistry(appProfile, input.outputRoot).catch(() => undefined)
      : undefined;
    const currentExecutionContract = buildSpecExecutionContract(plan, authoritativeSourceScenario, {
      appSlug: appProfile.appSlug,
      sectionSlug,
      pageObjectRegistry: currentRegistry,
    });
    const semanticContext = {
      requiredAssertions: (authoritativeSourceScenario.observableOracles ?? []).map((oracle) => oracle.requirement),
      observableOracles: authoritativeSourceScenario.observableOracles ?? [],
      scenarioSteps: authoritativeSourceScenario.steps ?? [],
      semanticErrors: [],
    };
    const existingRoute = await tryPromoteExistingSpecBeforeGeneration({
      caseDir: appPaths.caseDir,
      specPath: appPaths.specPath,
      planPath: appPaths.planPath,
      freshPlan: plan,
      appSlug: appProfile.appSlug,
      sectionSlug,
      caseId: plan.scenario.caseId,
      sourceScenario: authoritativeSourceScenario,
      executionContract: currentExecutionContract as unknown as Record<string, unknown>,
      semanticContext,
    });
    if (existingRoute.handled && existingRoute.promoted) {
      const promotedEntry = JSON.parse(await fs.readFile(path.join(appPaths.caseDir, "automation.json"), "utf8")) as PromotedAutomationIndexEntry;
      return promotedEntry;
    }
  }

  // Generate spec — POM-aware when policy provided
  const inlineDebugMode = input.inlineDebugMode ?? false;
  let pomStatus: POMPromotionStatus | undefined;
  let strategyDiagnostics: {
    requestedStrategy: "pom" | "inline" | "auto";
    autoPomEnabled: boolean;
    selectedStrategy: "pom" | "inline";
    reason: string;
    blockers: string[];
    availablePageObjects: string[];
    requiredPageMethods: string[];
    missingPageMethods: string[];
    autoPomAttempted: boolean;
    autoPomCreatedMethods: string[];
    fallbackUsed: boolean;
    requirePomRuntime: boolean;
  } | undefined;
  let pomDiagnostics: {
    status?: "needs_page_object" | "promoted";
    inlineFallbackUsed?: boolean;
    reason?: string;
    requiredDataUsed?: string[];
    generatedPageObjects?: string[];
    generatedMethods?: string[];
    missingPageObjects: string[];
    missingMethods: string[];
    generatedCandidates: number;
    autoPom?: AutoPomDiagnostics;
  } | undefined;
  let generatedSpecContent = "";
  let registryForSpecValidation: PageObjectRegistry | undefined;
  let specGenerationDiagnostics: SpecGenerationDiagnostics | undefined;
  // Generation-metadata signal, not scenario authority (never added to SpecExecutionContract):
  // set only after the deterministic branch below has already fail-closed-verified
  // unsupportedCapabilities=0 and compiledActionBindings=requiredActionSteps.
  let candidateAuthority: "deterministic_compiler" | undefined;

  if (promotionPolicy && promotionPolicy.specMode === "page-object") {
    const registry = await loadPageObjectRegistry(appProfile, input.outputRoot).catch(() => undefined);
    registryForSpecValidation = registry;

    // Detect if plan requires AuthFlow from metadata (preferred) or auth-consumed steps (legacy)
    const authFlowMetadata = plan.metadata?.authFlowRequired
      ? {
          alias: plan.metadata.authFlowAlias || "defaultClient",
          landing: plan.metadata.authFlowLanding || "transactions_menu",
          insertionAfterStepIndex: plan.metadata.authFlowInsertionAfterStepIndex,
          contractBinding: (plan.executionContract as any)?.auth?.aggregate
        }
      : undefined;
    
    // Legacy detection: check for auth-consumed step descriptions
    const hasAuthConsumedSteps = !authFlowMetadata && plan.steps.some(s => {
      const desc = (s.description ?? "").toLowerCase();
      return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
    });
    
    const authFlowOptions = authFlowMetadata ?? (hasAuthConsumedSteps ? {
      alias: "defaultClient",
      landing: "transactions_menu"
    } : undefined);

    let specResult: Awaited<ReturnType<typeof generateSpecFromPlanWithPolicy>>;

    if (input.useDeterministicSpecCompiler === true) {
      // SpecExecutionContract -> compileDeterministicSpec -> candidate source, inserted directly
      // into the existing production entrypoint (no parallel pipeline). aiInvoked=false on this
      // branch: when the contract lacks full authority for every required action, this fails
      // closed rather than falling back to AI generation.
      // Import paths are computed from the REAL materialization target this
      // pipeline already owns -- never re-derived from appSlug/sectionSlug/
      // scenarioId. Fail closed (no silently-wrong imports) if that target
      // path isn't known yet.
      if (!appPaths.specPath) {
        throw new Error(
          `DETERMINISTIC_SPEC_GENERATION_FAILED_CLOSED: scenarioId=${plan.scenario.externalId} ` +
          `failedGate=deterministic_missing_target_spec_path fallbackReason=no_ai_fallback_permitted`
        );
      }
      // This flow never needs Auto-POM to propose/approve new methods (specResult.pomStatus is
      // always "promoted" below, which is exactly what skips that), but buildSpecExecutionContract
      // still queries this SAME registry for existing page_object-kind implementation authority.
      // Re-verify already-active/available methods against real source BEFORE that lookup, so a
      // stale entry (active=true/available=true but the method no longer exists in the real Page
      // Object file) can never be selected as implementation authority -- reusing the same core
      // reconciliation Auto-POM itself already applies, never a second parser/verification.
      if (registry) {
        const { reconciledMethods } = await reconcileActivePageObjectMethods(registry, appPaths.pagesDir);
        if (reconciledMethods.length > 0) {
          console.log(`[deterministic-registry-reconciliation] demoted=${JSON.stringify(reconciledMethods)}`);
          await savePageObjectRegistry(registry, appProfile, input.outputRoot);
        }
      }
      const deterministicContract = buildSpecExecutionContract(plan, authoritativeSourceScenario, {
        appSlug: appProfile.appSlug,
        sectionSlug,
        pageObjectRegistry: registry,
      });
      const deterministicResult = compileDeterministicSpec(deterministicContract, { targetSpecPath: appPaths.specPath });
      const requiredActionSteps = deterministicContract.steps.filter(
        (s) => s.required !== false && ["fill", "press", "click"].includes(s.operation),
      ).length;
      const compiledActionBindings = deterministicResult.bindings.filter((b) => b.runtimeMethod !== "expectPromotedVisible").length;
      const failedGate = deterministicResult.unsupportedCapabilities.length > 0
        ? "deterministic_unsupported_capabilities"
        : compiledActionBindings !== requiredActionSteps
          ? "deterministic_action_binding_mismatch"
          : undefined;
      console.log(
        `[deterministic-spec-generation] scenarioId=${plan.scenario.externalId} finalSpecOrigin=deterministic_compiler ` +
        `requiredActions=${requiredActionSteps} compiledActionBindings=${compiledActionBindings} ` +
        `unsupportedCapabilities=${deterministicResult.unsupportedCapabilities.length} aiInvoked=false failedGate=${failedGate ?? "none"}`
      );
      if (failedGate) {
        throw new Error(
          `DETERMINISTIC_SPEC_GENERATION_FAILED_CLOSED: scenarioId=${plan.scenario.externalId} ` +
          `failedGate=${failedGate} fallbackReason=no_ai_fallback_permitted ` +
          `unsupportedCapabilities=${JSON.stringify(deterministicResult.unsupportedCapabilities)} ` +
          `requiredActions=${requiredActionSteps} compiledActionBindings=${compiledActionBindings}`
        );
      }
      specResult = {
        specContent: deterministicResult.source,
        selectedStrategy: "pom",
        fallbackUsed: false,
        pomStatus: "promoted",
        usedPageObjects: [],
        missingPageObjects: [],
        missingMethods: [],
        generatedCandidates: 0,
        validationErrors: [],
      };
      candidateAuthority = "deterministic_compiler";
    } else {
      specResult = await generateSpecFromPlanWithPolicy({
        plan,
        automationId,
        appProfile,
        appPaths,
        sectionSlug,
        scenarioId: plan.scenario.externalId,
        promotionPolicy,
        inlineDebugMode,
        pageObjectRegistry: registry,
        authFlowOptions
      });
    }
    generatedSpecContent = specResult.specContent;
    pomStatus = specResult.pomStatus;

    const requirePomRuntime = input.requirePomRuntime === true || process.env.PROMOTION_REQUIRE_POM_RUNTIME === "true";
    const selectedStrategy = specResult.selectedStrategy;
    const blockers = [
      ...(specResult.missingPageObjects ?? []).map((m) => `missing_page_object:${m}`),
      ...(specResult.missingMethods ?? []).map((m) => `missing_method:${m}`),
      ...(specResult.validationErrors ?? []).map((e) => `validation_error:${e}`),
      ...(specResult.fallbackReason ? [specResult.fallbackReason] : [])
    ];
    strategyDiagnostics = {
      requestedStrategy: promotionPolicy?.autoPom ? "auto" : "pom",
      autoPomEnabled: promotionPolicy?.autoPom === true,
      selectedStrategy,
      reason: selectedStrategy === "pom" ? (pomStatus ?? "promoted") : (specResult.fallbackReason ?? "inline_fallback"),
      blockers,
      availablePageObjects: registry?.pageObjects?.map((po) => po.className) ?? [],
      requiredPageMethods: [],
      missingPageMethods: specResult.missingMethods ?? [],
      autoPomAttempted: false,
      autoPomCreatedMethods: [],
      fallbackUsed: specResult.fallbackUsed,
      requirePomRuntime
    };

    if (requirePomRuntime) {
      const hasRuntime = specResult.specContent.includes("createPromotedSpecRuntime(") && specResult.specContent.includes(`PROMOTED_SPEC_STRATEGY = "pom_runtime"`);
      if (selectedStrategy !== "pom" || !hasRuntime) {
        throw new Error(
          `POM_RUNTIME_REQUIRED_BUT_UNAVAILABLE: blockers=${blockers.join(" | ") || "unknown"}`
        );
      }
    }

    // Fail promotion if spec validation found critical issues
    if (specResult.validationErrors && specResult.validationErrors.length > 0) {
      for (const err of specResult.validationErrors) {
        console.error(`[promote-plan] Spec validation error: ${err}`);
      }
      throw new Error(
        `Spec validation failed: ${specResult.validationErrors.join("; ")}. ` +
        "Promotion blocked to prevent degraded spec from being promoted."
      );
    }

    // Register POM candidates if any were generated
    if (specResult.generatedCandidates > 0 && registry) {
      const { savePageObjectRegistry } = await import("./page-object-registry");
      await savePageObjectRegistry(registry, appProfile, input.outputRoot);
    }

    // Register POM candidates when promotion is blocked by missing page objects/methods
    const pomCandidateResult = await registerPOMCandidatesForBlockedPromotion(
      plan,
      automationId,
      appProfile,
      input.outputRoot,
      specResult.pomStatus,
      specResult.missingMethods
    );

    if (pomCandidateResult.pomCandidatesRegistered > 0) {
      console.log(`[promote-plan] Registered ${pomCandidateResult.pomCandidatesRegistered} POM candidate(s) for blocked promotion`);
    }

    pomDiagnostics = {
      status: specResult.pomStatus === "promoted" ? "promoted" : "needs_page_object",
      inlineFallbackUsed: specResult.inlineFallbackUsed ?? false,
      reason: specResult.pomStatus ?? "unknown",
      requiredDataUsed: specResult.requiredDataUsed ?? [],
      generatedPageObjects: [],
      generatedMethods: [],
      missingPageObjects: specResult.missingPageObjects,
      missingMethods: specResult.missingMethods,
      generatedCandidates: specResult.generatedCandidates
    };

    // --- Auto-POM Pipeline ---
    if (shouldRunAutoPom(specResult.pomStatus, promotionPolicy)) {
      console.log(`[promote-plan] Auto-POM triggered for status: ${specResult.pomStatus}`);
      const autoPomResult = await runAutoPomPipeline({
        plan,
        automationId,
        appProfile,
        appPaths,
        sectionSlug,
        scenarioId: plan.scenario.externalId,
        outputRoot: input.outputRoot,
        promotionPolicy,
        inlineDebugMode: input.inlineDebugMode ?? false,
        initialPomStatus: specResult.pomStatus,
        initialMissingMethods: specResult.missingMethods
      });

      pomStatus = autoPomResult.pomStatus;

      if (autoPomResult.diagnostics.finalPomStatus === "promoted") {
        generatedSpecContent = autoPomResult.specContent;
        console.log(`[promote-plan] Auto-POM succeeded, spec regenerated and promoted.`);
      } else {
        generatedSpecContent = autoPomResult.specContent;
        console.log(`[promote-plan] Auto-POM completed but promotion still blocked: ${autoPomResult.diagnostics.finalPomStatus}`);
      }

      pomDiagnostics = {
        ...pomDiagnostics,
        status: autoPomResult.diagnostics.finalPomStatus === "promoted" ? "promoted" : "needs_page_object",
        reason: autoPomResult.diagnostics.finalPomStatus,
        generatedPageObjects: autoPomResult.diagnostics.autoApprovedPageObjects,
        generatedMethods: autoPomResult.diagnostics.autoApprovedMethods,
        missingPageObjects: autoPomResult.diagnostics.finalPomStatus === "promoted" ? [] : (pomDiagnostics?.missingPageObjects ?? []),
        missingMethods: autoPomResult.diagnostics.finalPomStatus === "promoted" ? [] : (pomDiagnostics?.missingMethods ?? []),
        autoPom: autoPomResult.diagnostics
      };
      if (strategyDiagnostics) {
        strategyDiagnostics.autoPomAttempted = true;
        strategyDiagnostics.autoPomCreatedMethods = autoPomResult.diagnostics.autoApprovedMethods ?? [];
        strategyDiagnostics.selectedStrategy = autoPomResult.diagnostics.finalPomStatus === "promoted" ? "pom" : strategyDiagnostics.selectedStrategy;
        strategyDiagnostics.reason = autoPomResult.diagnostics.finalPomStatus;
        strategyDiagnostics.fallbackUsed = strategyDiagnostics.selectedStrategy !== "pom";
      }

      // FIRST_LOSS fix: Auto-POM persists its own approvals to disk (savePageObjectRegistry,
      // inside runAutoPomPipeline) and even reloads its own local copy to regenerate the spec --
      // but `registryForSpecValidation` here is the snapshot taken BEFORE this pipeline ran, and
      // was never refreshed. `runHybridSpecGeneration` below then validates the AI candidate's
      // Page Object imports against that stale authority and rejects an object Auto-POM
      // legitimately approved moments earlier, in this SAME job. Reload from the same
      // authoritative persisted source Auto-POM itself just wrote to -- no parallel registry, no
      // symbol-name allowlist.
      registryForSpecValidation = await loadPageObjectRegistry(appProfile, input.outputRoot).catch(() => registryForSpecValidation);
    }
  } else {
    const specContent = generateSpecFromPlan(plan, automationId, appProfile, appPaths, {
      sectionSlug,
      scenarioId: plan.scenario.externalId
    });
    generatedSpecContent = specContent;
    pomStatus = inlineDebugMode ? "inline_debug_only" : undefined;
    strategyDiagnostics = {
      requestedStrategy: "inline",
      autoPomEnabled: false,
      selectedStrategy: "inline",
      reason: "inline_mode_requested",
      blockers: [],
      availablePageObjects: [],
      requiredPageMethods: [],
      missingPageMethods: [],
      autoPomAttempted: false,
      autoPomCreatedMethods: [],
      fallbackUsed: false,
      requirePomRuntime: input.requirePomRuntime === true || process.env.PROMOTION_REQUIRE_POM_RUNTIME === "true"
    };
  }

  const specGenerationResult = await runHybridSpecGeneration({
    plan,
    deterministicDraft: generatedSpecContent,
    candidateAuthority,
    appProfile,
    appPaths,
    sectionSlug,
    scenarioId: plan.scenario.externalId,
    promotionPolicy,
    pageObjectRegistry: registryForSpecValidation,
    sourceScenario: authoritativeSourceScenario,
    runtimeInputValues,
    headed: input.headed,
    executionSource: input.executionSource,
  });
  const generatedExecutionContract = (specGenerationResult as typeof specGenerationResult & {
    executionContract?: unknown;
  }).executionContract;
  const planContent = JSON.stringify({
    ...plan,
    ...(authoritativeSourceScenario ? { sourceScenario: authoritativeSourceScenario } : {}),
    ...(generatedExecutionContract ? { executionContract: generatedExecutionContract } : {})
  }, null, 2);
  await writeFileAtomicWithRetry(appPaths.planPath, planContent);
  if (appPaths.caseConfigPath) {
    await writeFileAtomicWithRetry(
      appPaths.caseConfigPath,
      JSON.stringify({
        id: automationId,
        externalId: plan.scenario.externalId,
        caseId: plan.scenario.caseId,
        title: plan.scenario.title,
        source: input.source ?? "manual",
        appSlug: appProfile.appSlug,
        appConfigPath: appPaths.configPath,
        createdAt: new Date().toISOString()
      }, null, 2)
    );
  }
  specGenerationDiagnostics = specGenerationResult.diagnostics;
  // DIAGNOSE-only instrumentation (this ticket): proves whether runHybridSpecGeneration's own
  // returned specContent already diverged from the deterministic draft passed into it, or
  // whether the divergence happens later in this function. No behavior change.
  console.log(
    `[deterministic-draft-tracking] draftSameAsHybridOutput=${generatedSpecContent === specGenerationResult.specContent} ` +
    `draftContainsPOM=${generatedSpecContent.includes("DeterministicPromotedPage")} ` +
    `hybridOutputContainsPOM=${specGenerationResult.specContent.includes("DeterministicPromotedPage")} ` +
    `hybridOutputContainsInlineExecutor=${specGenerationResult.specContent.includes("inline_executor")}`
  );
  generatedSpecContent = specGenerationResult.specContent;
  generatedSpecContent = rewritePromotedRuntimeImport(generatedSpecContent, appPaths.specPath);
  generatedSpecContent = rewritePromotedAuthFlowHelperImport(generatedSpecContent, appPaths.specPath, appProfile.appSlug);
  generatedSpecContent = ensurePromotedSpecNavigation(generatedSpecContent, plan);
  generatedSpecContent = ensurePromotedSpecStrategyMarker(generatedSpecContent, strategyDiagnostics?.selectedStrategy);
  const promotedImportValidation = await validatePromotedSpecInternalImports(generatedSpecContent, appPaths.specPath);
  console.log(`[promoted-spec-imports] specPath=${appPaths.specPath} internalImports=${promotedImportValidation.internalImports} resolved=${promotedImportValidation.resolved} unresolved=${promotedImportValidation.unresolved.length}`);

  const previousSpec = await readExistingSpecInfo(appPaths.specPath);
  let specWritten = false;
  let specPromotionAllowed = specGenerationResult.promotionAllowed && promotedImportValidation.unresolved.length === 0;
  if (promotedImportValidation.unresolved.length > 0) {
    specGenerationDiagnostics.errors.push(`promoted_spec_internal_imports_unresolved:${promotedImportValidation.unresolved.join(",")}`);
  }
  if (specPromotionAllowed) {
    await writeFileAtomicWithRetry(appPaths.specPath, generatedSpecContent);
    specWritten = true;
  } else {
    pomStatus = "needs_manual_review";
    if (strategyDiagnostics) {
      strategyDiagnostics.blockers.push("spec_generation_validation_failed");
      strategyDiagnostics.reason = "spec_generation_validation_failed";
    }
  }
  if (specGenerationDiagnostics) {
    specGenerationDiagnostics.specWritten = specWritten;
    specGenerationDiagnostics.previousSpec = previousSpec;
  }

  if (appPaths.caseDir && strategyDiagnostics) {
    strategyDiagnostics = {
      ...strategyDiagnostics,
      specPath: appPaths.specPath,
      specHash: createHash("sha256").update(generatedSpecContent).digest("hex"),
      specSource: specWritten ? "generatedSpec" : "ai_candidate",
    } as typeof strategyDiagnostics & { specPath: string; specHash: string; specSource: "generatedSpec" | "ai_candidate" };
    await writeFileAtomicWithRetry(path.join(appPaths.caseDir, "promotion-diagnostics.json"), JSON.stringify(strategyDiagnostics, null, 2));
  }

  const requirePomRuntimeContract = input.requirePomRuntime === true || process.env.PROMOTION_REQUIRE_POM_RUNTIME === "true";
  if (requirePomRuntimeContract && appPaths.specPath && specPromotionAllowed) {
    const diagnosticsPath = appPaths.caseDir ? path.join(appPaths.caseDir, "promotion-diagnostics.json") : undefined;
    const contractResult = await validatePromotedSpecRuntimeContract(appPaths.specPath, diagnosticsPath);
    if (!contractResult.valid) {
      throw new Error(
        `PROMOTED_SPEC_RUNTIME_CONTRACT_INVALID: ${contractResult.errors.join(" | ")}`
      );
    }
  }

  if (input.persistAppConfig !== false) {
    const existingConfig = loadPromotedAppConfigSync({ appSlug: appProfile.appSlug });
    const appConfig = serializeRuntimeConfigForPromotion(input.fullConfig ?? envConfig, existingConfig);
    appConfig.appProfile = {
      ...appConfig.appProfile,
      appSlug: appProfile.appSlug,
      name: appProfile.name ?? appConfig.appProfile.name,
      baseUrl: appProfile.baseUrl ?? appConfig.appProfile.baseUrl,
      baseUrlHash: appProfile.baseUrlHash ?? appConfig.appProfile.baseUrlHash,
      updatedAt: new Date().toISOString()
    };
    await savePromotedAppConfig(appConfig, input.outputRoot);
  }

  const appDirPaths = buildAppAutomationPaths(appProfile, undefined, input.outputRoot);
  const appIndexPath = appDirPaths.indexPath;
  const appIndex = await loadAutomationIndex(appIndexPath);
  const source: "agent_handoff" | "manual" | "rule_based" | "discovery" =
    input.source ?? "manual";
  const rawAutomationStatus = determineAutomationStatus(plan.status, source);

  // Override status if POM requires a non-active status
  const automationStatus = !specPromotionAllowed
    ? "spec_failed"
    : pomStatus === "inline_debug_only"
    ? "inline_debug_only"
    : pomStatus === "needs_page_object" || pomStatus === "needs_page_method"
      ? "blocked_missing_pom"
      : pomStatus === "needs_manual_review"
        ? "blocked_missing_pom"
        : rawAutomationStatus;

  const now = new Date().toISOString();

  const appIndexEntry: PromotedAutomationIndexEntry = {
    id: automationId,
    externalId: plan.scenario.externalId,
    caseId: plan.scenario.caseId,
    title: plan.scenario.title,
    planPath: appPaths.planPath,
    specPath: appPaths.specPath,
    appSlug: appProfile.appSlug,
    appConfigPath: appDirPaths.configPath,
    status: automationStatus,
    source,
    appProfile: appProfile.appSlug,
    baseUrlHash: appProfile.baseUrlHash,
    createdAt: now,
    updatedAt: now,
    lastPromotedFrom: input.sourcePlanPath,
    lastExecutionResultPath: input.lastExecutionResultPath,
    pomStatus,
    inlineDebugMode,
    specVerificationStatus: specPromotionAllowed ? "passed" : "failed",
    metadata: pomDiagnostics || wasOverwritten || specGenerationDiagnostics ? {
      ...metadata,
      ...(pomDiagnostics ? { pomDiagnostics } : {}),
      ...(specGenerationDiagnostics ? { specGeneration: specGenerationDiagnostics } : {}),
      ...(strategyDiagnostics ? { promotionStrategyDiagnostics: strategyDiagnostics } : {}),
      ...(wasOverwritten ? {
        overwritten: true,
        previousAutomationPath,
        previousStatus
      } : {})
    } : metadata,
    ...(specPromotionAllowed ? buildPromotedArtifactIdentity(appPaths.specPath, generatedSpecContent) : {})
  };

  // --- Verify promoted spec if requested ---
  if (input.verifySpec && appPaths.specPath && automationStatus === "active") {
    console.log(`[promote-plan] Running spec verification for ${appPaths.specPath}`);
    const verificationResult = await verifyPromotedSpec(
      appPaths.specPath,
      input.specVerificationTimeoutMs ?? 90000
    );

    appIndexEntry.specVerificationStatus = verificationResult.status;

    if (verificationResult.status === "failed") {
      console.error(`[promote-plan] Spec verification FAILED. Promotion marked as spec_failed.`);
      appIndexEntry.status = "spec_failed";
      delete (appIndexEntry as any).promotionPersisted;
      delete (appIndexEntry as any).promotedSpecPath;
      delete (appIndexEntry as any).promotedSpecHash;
      appIndexEntry.metadata = {
        ...appIndexEntry.metadata,
        specVerification: {
          status: "failed",
          error: verificationResult.error,
          tracePath: verificationResult.tracePath,
          screenshotPath: verificationResult.screenshotPath
        }
      };
    } else if (verificationResult.status === "passed") {
      console.log(`[promote-plan] Spec verification PASSED`);
      appIndexEntry.metadata = {
        ...appIndexEntry.metadata,
        specVerification: {
          status: "passed"
        }
      };
    }
  }

  const updatedAppIndex = upsertAutomationIndexEntry(appIndex, appIndexEntry);
  await saveAutomationIndex(updatedAppIndex, appIndexPath);

  if (appPaths.caseAutomationPath) {
    await writeFileAtomicWithRetry(appPaths.caseAutomationPath, JSON.stringify(appIndexEntry, null, 2));
  }
  if (appPaths.caseDir && strategyDiagnostics) {
    await writeFileAtomicWithRetry(path.join(appPaths.caseDir, "promotion-diagnostics.json"), JSON.stringify(strategyDiagnostics, null, 2));
  }

  // --- Update global index too ---
  const globalIndexPath =
    input.outputRoot !== undefined
      ? path.join(input.outputRoot, "automations/index.json")
      : undefined;

  const globalIndex = await loadAutomationIndex(globalIndexPath);
  const updatedGlobalIndex = upsertAutomationIndexEntry(globalIndex, appIndexEntry);
  await saveAutomationIndex(updatedGlobalIndex, globalIndexPath);

  return appIndexEntry;
}
