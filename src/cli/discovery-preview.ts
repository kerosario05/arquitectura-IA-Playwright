import path from "node:path";
import fs from "node:fs/promises";
import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { runCaseDiscoveryWorkflow } from "../discovery/case-discovery-workflow";
import { resolveAppProfile, ensureAppStructure, loadPromotedAppConfigSync } from "../automations/app-profile";
import type { VirtualCase } from "../types/scenario-preview.types";
import type { TestScenario } from "../types/testrail.types";
import { RunEvidenceRecorder } from "../evidence/run-evidence-recorder";
import { loadEvidenceConfig } from "../evidence/evidence-types";

export type PreviewCliArgs = {
  input: string;
  app: string;
  headed: boolean;
  autoPromote: boolean;
  autoPom: boolean;
  rerunActive: boolean;
  overwrite: boolean;
  deferEvidenceConsolidation: boolean;
  dryRun: boolean;
  help: boolean;
};

export type PreviewResult = {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  results?: Array<Record<string, unknown>>;
  topFailedCases?: Array<Record<string, unknown>>;
  dominantFailure?: string | null;
  nextFix?: string | null;
  cases: Array<{
    id: string;
    displayId: string;
    title: string;
    status: "passed" | "failed" | "skipped";
    outputDir?: string;
    specPath?: string;
    error?: string;
    durationMs?: number;
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
};

type PreviewCaseResult = PreviewResult["cases"][number] & {
  caseId?: string;
  discoveryStatus?: string;
  promotionStatus?: string;
  promotionReason?: string;
  specGenerationStatus?: string;
  automationReady?: boolean;
  specWritten?: boolean;
  promotionAllowed?: boolean;
  finalSpecOrigin?: string | null;
  fallbackUsed?: boolean;
  aiInvoked?: boolean;
  aiAttempts?: number;
  specGenerationAttempts?: number;
  specRepairAttempts?: number;
  firstPassPromotion?: boolean;
  oracleTypes?: string[];
  provider?: string | null;
  model?: string | null;
  failedTargets?: string[];
  failedAssertions?: string[];
  failureType?: string;
  phase?: string;
  appSlug?: string;
  routeProfileUsed?: boolean;
  assertionRecovery?: {
    recovered: boolean;
    decision?: string;
    attempts?: string[];
  };
  assertionImportance?: string;
  conditionalAssertion?: boolean;
  conditionalRisk?: string;
  reviewNeededReason?: string;
};

type PreviewCompletion = {
  eventStatus: "passed" | "failed";
  automationReady: boolean;
  promotionAllowed: boolean;
  specWritten: boolean;
  specGenerationStatus: "passed" | "failed" | "not_applicable";
  finalSpecOrigin: string | null;
  fallbackUsed: boolean;
  aiInvoked: boolean;
  aiAttempts: number;
  specGenerationAttempts: number;
  specRepairAttempts: number;
  firstPassPromotion: boolean;
  oracleTypes: string[];
  provider: string | null;
  model: string | null;
  reason: string;
};

export function resolvePreviewCompletion(
  workflowResult: {
    caseResult?: { status?: string } | undefined;
    promotionStatus?: string;
    specPath?: string;
    specGeneration?: {
      provider: string | null;
      model: string | null;
      invocations: number;
      invocationsConsumed: number;
      specGenerationAttempts?: number;
      specRepairAttempts?: number;
      firstPassPromotion?: boolean;
      oracleTypes?: string[];
      promotionAllowed: boolean;
      specWritten?: boolean;
      finalSpec: { origin: string; fallback: Record<string, unknown> | null };
    } | undefined;
  },
  autoPromote: boolean,
): PreviewCompletion {
  const discoveryStatus = workflowResult.caseResult?.status ?? "";
  const discoveryPassed =
    discoveryStatus === "discovered_passed"
    || discoveryStatus === "repaired_passed"
    || discoveryStatus === "discovered_partial";
  const specGeneration = workflowResult.specGeneration;
  const promotionAllowed = specGeneration?.promotionAllowed === true;
  const specWritten = specGeneration?.specWritten === true;
  const finalSpecOrigin = specGeneration?.finalSpec?.origin ?? null;
  const fallbackUsed = Boolean(specGeneration?.finalSpec?.fallback?.applied);
  const aiAttempts = specGeneration?.invocationsConsumed ?? specGeneration?.invocations ?? 0;
  const aiInvoked = aiAttempts > 0;
  const specGenerationAttempts = specGeneration?.specGenerationAttempts ?? aiAttempts;
  const specRepairAttempts = specGeneration?.specRepairAttempts ?? Math.max(0, specGenerationAttempts - 1);
  const firstPassPromotion = specGeneration?.firstPassPromotion ?? (promotionAllowed && specRepairAttempts === 0);
  const oracleTypes = specGeneration?.oracleTypes ?? [];
  const provider = specGeneration?.provider ?? null;
  const model = specGeneration?.model ?? null;
  const automationReady = autoPromote
    ? discoveryPassed
      && workflowResult.promotionStatus === "promoted"
      && promotionAllowed
      && specWritten
      && typeof workflowResult.specPath === "string"
      && workflowResult.specPath.length > 0
    : discoveryPassed;

  return {
    eventStatus: automationReady ? "passed" : "failed",
    automationReady,
    promotionAllowed,
    specWritten,
    specGenerationStatus: autoPromote
      ? (automationReady ? "passed" : "failed")
      : "not_applicable",
    finalSpecOrigin,
    fallbackUsed,
    aiInvoked,
    aiAttempts,
    specGenerationAttempts,
    specRepairAttempts,
    firstPassPromotion,
    oracleTypes,
    provider,
    model,
    reason: autoPromote
      ? (automationReady ? "automation_ready" : "automation_not_ready")
      : discoveryStatus === "discovered_partial"
        ? "observable_assertion_requires_discovery"
        : discoveryPassed
          ? "all_targets_validated"
          : "blocking_failures",
  };
}

export function classifyPreviewFailure(caseRes: PreviewCaseResult): {
  failureType: string;
  phase: string;
} {
  const errorMsg = String(caseRes.error ?? "").toLowerCase();
  const promotionReason = String(caseRes.promotionReason ?? "").toLowerCase();
  const joined = `${errorMsg} ${promotionReason}`;

  // Check for conditional assertion without data requirement first
  if (joined.includes("conditional_assertion_without_data") || (caseRes as any).conditionalAssertion && (caseRes as any).conditionalRisk === "high") {
    return { failureType: "conditional_assertion_without_data", phase: "assertion_validation" };
  }

  // Check for unstable assertion risk
  if (joined.includes("unstable_assertion_risk")) {
    return { failureType: "unstable_assertion_risk", phase: "assertion_validation" };
  }

  if (
    joined.includes("err_connection_closed") ||
    joined.includes("err_connection_reset") ||
    joined.includes("err_timed_out") ||
    joined.includes("err_name_not_resolved") ||
    joined.includes("page.goto timeout") ||
    joined.includes("browser has been closed") ||
    joined.includes("target page, context or browser has been closed")
  ) {
    return { failureType: "environment_navigation_error", phase: "navigation_start" };
  }

  if (joined.includes("ai_repair_candidate_not_enabled") || joined.includes("candidate not enabled")) {
    return { failureType: "ai_repair_candidate_not_enabled", phase: "ai_repair" };
  }

  if (joined.includes("ai_repair_schema_invalid") || joined.includes("confidence must be numeric")) {
    return { failureType: "ai_repair_schema_invalid", phase: "ai_repair" };
  }

  if (
    joined.includes("ordinal_candidates_disabled") ||
    joined.includes("ordinal_selection_no_candidates") ||
    joined.includes("ordinal_selection_ambiguous") ||
    joined.includes("no_enabled_clickable_candidate") ||
    joined.includes("no_safe_candidate")
  ) {
    return { failureType: "ordinal_selection_no_safe_candidate", phase: "ordinal_selection" };
  }

  if (caseRes.reviewNeededReason === "unsafe_action_requires_review") {
    return { failureType: "unsafe_action_requires_review", phase: "ai_repair" };
  }

  if (caseRes.reviewNeededReason === "fragile_scenario_review_needed") {
    return { failureType: "fragile_scenario_review_needed", phase: "assertion_validation" };
  }

  if (caseRes.reviewNeededReason === "conditional_assertion_without_data") {
    return { failureType: "conditional_assertion_without_data", phase: "assertion_validation" };
  }

  const assertionImportance = caseRes.assertionImportance ?? "blocking";
  if (caseRes.failedAssertions && caseRes.failedAssertions.length > 0) {
    if (assertionImportance === "contextual") {
      return { failureType: "contextual_assertion_not_found", phase: "assertion_validation" };
    }
    if (assertionImportance === "optional") {
      return { failureType: "optional_assertion_not_found", phase: "assertion_validation" };
    }
    return { failureType: "assertion_not_found_unrecovered", phase: "assertion_validation" };
  }

  if (caseRes.promotionStatus === "not_applicable") {
    return { failureType: "promotion_not_applicable", phase: "promotion_gate" };
  }

  return { failureType: "target_not_found", phase: "target_resolution" };
}

export async function resolvePreviewAppProfile(cliAppSlug: string): Promise<{ resolvedAppSlug: string; appProfileObj: any }> {
  let resolvedAppSlug = cliAppSlug;
  let appProfileObj: any = undefined;
  try {
    const appProfileResult = await resolveAppProfile({ cliAppSlug });
    resolvedAppSlug = appProfileResult.profile.appSlug;
    appProfileObj = {
      ...appProfileResult.profile,
      appSlug: resolvedAppSlug,
      source: "cli",
      appDir: `automations/apps/${resolvedAppSlug}`,
      configPath: `automations/apps/${resolvedAppSlug}/app.config.json`
    };
    await ensureAppStructure(resolvedAppSlug);
  } catch (err) {
    console.log(`[discovery:preview] Could not resolve app profile for ${cliAppSlug}: ${err instanceof Error ? err.message : String(err)}`);
    appProfileObj = {
      appSlug: cliAppSlug,
      source: "cli",
      appDir: `automations/apps/${cliAppSlug}`,
      configPath: `automations/apps/${cliAppSlug}/app.config.json`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  return { resolvedAppSlug, appProfileObj };
}

export function buildPreviewFailureGroups(results: PreviewResult["cases"]) {
  const failureGroups = {
    environment_navigation_error: 0,
    assertion_not_found_unrecovered: 0,
    contextual_assertion_not_found: 0,
    optional_assertion_not_found: 0,
    conditional_assertion_without_data: 0,
    unsafe_action_requires_review: 0,
    fragile_scenario_review_needed: 0,
    unstable_assertion_risk: 0,
    ordinal_selection_no_safe_candidate: 0,
    ai_repair_candidate_not_enabled: 0,
    ai_repair_schema_invalid: 0,
    assertion_not_found: 0,
    target_not_found: 0,
    route_profile_missing: 0,
    promotion_not_applicable: 0
  };

  for (const caseRes of results as Array<any>) {
    if (caseRes.status !== "failed") {
      continue;
    }

    const classifiedFailure = classifyPreviewFailure(caseRes as PreviewCaseResult);
    if (classifiedFailure.failureType in failureGroups) {
      (failureGroups as any)[classifiedFailure.failureType] += 1;
    }

    let classified = false;
    const errorMsg = String(caseRes.error ?? "").toLowerCase() + " " + String(caseRes.promotionReason ?? "").toLowerCase();
    const hasRouteProfileIssue = errorMsg.includes("routeprofile loaded=false") ||
      errorMsg.includes("routeprofile missing") ||
      errorMsg.includes("no routeprofile in app.config.json") ||
      errorMsg.includes("loaded=false") ||
      errorMsg.includes("route_profile_missing") ||
      (caseRes.failedTargets && caseRes.failedTargets.some((t: any) => String(t).toLowerCase().includes("routeprofile"))) ||
      (caseRes.failedAssertions && caseRes.failedAssertions.some((a: any) => String(a).toLowerCase().includes("routeprofile")));

    if (hasRouteProfileIssue) {
      failureGroups.route_profile_missing++;
      classified = true;
    }

    const isPromoNotApplicable = caseRes.promotionStatus === "not_applicable" ||
      caseRes.discoveryStatus === "discovered_partial" ||
      caseRes.discoveryStatus === "exploration_failed" ||
      errorMsg.includes("promotion not applicable") ||
      errorMsg.includes("discovered_partial") ||
      errorMsg.includes("exploration_failed");

    if (isPromoNotApplicable) {
      failureGroups.promotion_not_applicable++;
      classified = true;
    }

    const hasAssertionFailure = (caseRes.failedAssertions && caseRes.failedAssertions.length > 0) ||
      errorMsg.includes("assertion") ||
      errorMsg.includes("no visible") ||
      errorMsg.includes("not visible") ||
      errorMsg.includes("no encontrada");

    if (hasAssertionFailure) {
      failureGroups.assertion_not_found++;
      classified = true;
    }

    const hasTargetFailure = (caseRes.failedTargets && caseRes.failedTargets.length > 0) ||
      errorMsg.includes("target not found") ||
      errorMsg.includes("target_not_found") ||
      errorMsg.includes("not found") ||
      errorMsg.includes("no encontrado") ||
      errorMsg.includes("el primer producto") ||
      errorMsg.includes("pesos");

    if (hasTargetFailure) {
      failureGroups.target_not_found++;
      classified = true;
    }

    if (!classified) {
      failureGroups.target_not_found++;
    }
  }

  return failureGroups;
}

export function buildPreviewSummaryReport(results: PreviewCaseResult[], total: number, failureGroups: Record<string, number>) {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const dominantFailure = Object.entries(failureGroups)
    .filter(([, count]) => count > 0)
    .sort((a, b) => {
      const aRoot = a[0] !== "promotion_not_applicable";
      const bRoot = b[0] !== "promotion_not_applicable";
      if (aRoot !== bRoot) return aRoot ? -1 : 1;
      return b[1] - a[1];
    })
    [0]?.[0] ?? null;
  const nextFixByFailure: Record<string, string> = {
    environment_navigation_error: "Verificar disponibilidad del ambiente y conectividad antes de interpretar el fallo como funcional.",
    assertion_not_found_unrecovered: "Fortalecer assertion recovery con equivalentes, espera segura y pasos intermedios no sensibles.",
    contextual_assertion_not_found: "Reclasificar assertions auxiliares como contextual para que no bloqueen la promoción.",
    optional_assertion_not_found: "Tratar assertions opcionales como no bloqueantes cuando no son el objetivo principal del caso.",
    ordinal_selection_no_safe_candidate: "Mejorar ordinal selection para priorizar candidatos visibles, habilitados y relacionados al domainTerm.",
    ai_repair_candidate_not_enabled: "Reforzar validación de AI repair para rechazar candidatos disabled y preferir scroll/intermediate step seguro.",
    ai_repair_schema_invalid: "Normalizar y validar la respuesta de IA antes de descartarla para que un repaired_plan útil no se pierda por schema menor.",
    promotion_not_applicable: "Investigar por qué discovery quedó parcial antes de llegar a promoción aplicable.",
    target_not_found: "Revisar target resolver y route completion para targets faltantes o pasos intermedios seguros.",
    conditional_assertion_without_data: "Evitar bloquear assertions condicionales sin data requerida y marcarlas como review_needed.",
    unsafe_action_requires_review: "Marcar acciones sensibles sin candidato seguro como review_needed en lugar de tumbar el preview.",
    fragile_scenario_review_needed: "Reducir el peso de assertions secundarias o fragmentar el escenario para evitar partials espurios.",
  };

  return {
    generated: total,
    executed: results.length,
    passed,
    failed,
    passRate,
    failureGroups,
    dominantFailure,
    nextFix: dominantFailure ? (nextFixByFailure[dominantFailure] ?? nextFixByFailure.target_not_found) : null,
    topFailedCases: results
      .filter((r) => r.status === "failed")
      .slice(0, 5)
      .map((r) => ({
        caseId: r.caseId ?? r.displayId,
        title: r.title,
        failureType: r.failureType ?? classifyPreviewFailure(r).failureType,
        error: r.error ?? r.promotionReason ?? "",
      })),
  };
}

function parsePreviewArgs(argv: string[]): PreviewCliArgs {
  const args: PreviewCliArgs = {
    input: "",
    app: "",
    headed: false,
    autoPromote: false,
    autoPom: false,
    rerunActive: false,
    overwrite: false,
    deferEvidenceConsolidation: false,
    dryRun: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--input" || arg === "-i") {
      const nextValue = argv[++i];
      if (!nextValue) throw new Error("Missing value for --input");
      args.input = nextValue;
    } else if (arg === "--app" || arg === "-a") {
      const nextValue = argv[++i];
      if (!nextValue) throw new Error("Missing value for --app");
      args.app = nextValue;
    } else if (arg === "--headed") {
      args.headed = true;
    } else if (arg === "--auto-promote") {
      args.autoPromote = true;
    } else if (arg === "--auto-pom") {
      args.autoPom = true;
    } else if (arg === "--rerun-active") {
      args.rerunActive = true;
    } else if (arg === "--overwrite") {
      args.overwrite = true;
    } else if (arg === "--defer-evidence-consolidation") {
      args.deferEvidenceConsolidation = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    i++;
  }

  if (!args.help) {
    if (!args.input) throw new Error("--input is required");
    if (!args.app) throw new Error("--app is required");
  }

  return args;
}

function printPreviewHelp(): void {
  console.log("Usage: tsx src/cli/discovery-preview.ts --input <file> --app <slug> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --input, -i        Path to preview-scenarios.json");
  console.log("  --app, -a          App slug to target");
  console.log("  --headed           Run browser headed");
  console.log("  --auto-promote     Promote passing cases");
  console.log("  --auto-pom         Auto-generate page objects");
  console.log("  --rerun-active     Rerun active cases");
  console.log("  --overwrite        Overwrite existing outputs");
  console.log("  --defer-evidence-consolidation  Skip run-level DOCX consolidation in this command");
  console.log("  --dry-run          Parse inputs without executing");
  console.log("  --help, -h         Show this help message");
}

async function loadVirtualCases(inputPath: string): Promise<VirtualCase[]> {
  const content = await fs.readFile(inputPath, "utf-8");
  const data = JSON.parse(content);
  if (!Array.isArray(data)) {
    throw new Error(`Expected array of virtual cases in ${inputPath}`);
  }
  return data as VirtualCase[];
}

export function virtualCaseToTestScenario(vc: VirtualCase): TestScenario {
  const embeddedCaseId = typeof vc.testRailCaseId === "number" && Number.isInteger(vc.testRailCaseId) && vc.testRailCaseId > 0
    ? vc.testRailCaseId
    : 0;
  const sectionName = vc.sectionName || undefined;
  const sectionSlug = vc.sectionSlug || undefined;
  return {
    source: embeddedCaseId > 0 ? "testrail" : "jira",
    externalId: embeddedCaseId > 0 ? `C${embeddedCaseId}` : vc.displayId,
    caseId: embeddedCaseId,
    title: vc.title,
    preconditions: vc.preconditions.join("\n"),
    authIntent: vc.authIntent,
    steps: vc.steps.map((step, index) => ({
      index,
      action: step,
      expected: "",
      dataHints: [],
    })),
    sectionName,
    sectionSlug,
    sectionId: vc.sectionId,
    routeProfile: vc.routeProfile,
    raw: {
      custom_preconds: vc.preconditions.join("\n"),
      custom_expected: vc.expectedResult,
      custom_steps: vc.steps.join("\n"),
      custom_steps_separated: vc.steps.map((step) => ({ content: step }))
    },
  } as any;
}

export function resolveWebBaseUrl(appSlug: string): { appSlug: string; source: string; configured?: string; effective: string; fallbackUsed: boolean } {
  const normalized = appSlug.trim();
  const cfg: any = loadPromotedAppConfigSync({ appSlug: normalized });
  const configured = typeof cfg?.baseUrl === "string" ? cfg.baseUrl.trim() : undefined;
  const hasConfigured = Boolean(configured);
  if (hasConfigured) {
    const safe = new URL(configured);
    console.log(`[web:base-url] appSlug=${normalized} source=app_config origin=${safe.origin} pathname=${safe.pathname} fallbackUsed=false`);
    return { appSlug: normalized, source: "app_config", configured, effective: configured!, fallbackUsed: false };
  }
  const envFallback = config.app.baseUrl;
  console.log(`[web:base-url] appSlug=${normalized} source=fallback configuredPresent=${Boolean(configured)} effectivePresent=${Boolean(envFallback)} fallbackUsed=true`);
  throw new Error(`[web:base-url] missing baseUrl for appSlug=${normalized} source=app_config — FAIL CLOSED: create automations/apps/${normalized}/app.config.json with baseUrl. Env fallback present=${Boolean(envFallback)} not used.`);
}

async function runPreviewCase(
  vc: VirtualCase,
  args: PreviewCliArgs,
  appSlug: string,
  appProfileObj: any,
  index: number,
  total: number,
  evidenceRunId?: string,
  executionSource: "qalab" | "cli" = "cli",
  effectiveBaseUrl?: string,
): Promise<PreviewResult["cases"][number]> {
  const outputDir = path.resolve(`./.artifacts/preview/${vc.displayId}/${new Date().toISOString().replace(/[:.]/g, "-")}`);

  // Emit JSON line for progress tracking (FASE 4)
  console.log(JSON.stringify({
    type: "case_started",
    caseId: vc.displayId,
    title: vc.title,
    index: index + 1,
    total,
  }));

  console.log(`\n[discovery:preview] starting ${vc.displayId}: ${vc.title}`);
  console.log(`[discovery:preview] appSlug=${appSlug} outputDir=${outputDir}`);

  let workflowResult: any;

  try {
    const scenario = virtualCaseToTestScenario(vc);

    const testRailConfig = requireTestRailConfig(config);
    const trClient = new TestRailClient(testRailConfig);

    // Build per-app config that preserves project baseUrl (fail-closed, no fallback to env default)
    const discoveryConfig: typeof config = effectiveBaseUrl
      ? { ...config, app: { ...config.app, baseUrl: effectiveBaseUrl, appProfile: appSlug } }
      : config;
    if (effectiveBaseUrl) {
      const safe = new URL(effectiveBaseUrl);
      console.log(`[web:base-url] appSlug=${appSlug} source=app_config origin=${safe.origin} pathname=${safe.pathname} fallbackUsed=false`);
    }
    // Per-scenario dataOverrides and suggestedData (generic, per-scenario isolated)
    const scenarioOverrides = (vc as any).dataOverrides as Record<string, string> | undefined;
    let scenarioSuggested: Record<string, string> | undefined;
    const vcDataReq = (vc as any).dataRequirements as any;
    if (Array.isArray(vcDataReq)) {
      const map: Record<string,string> = {};
      for (const r of vcDataReq) {
        if (r && r.key && r.suggestedValue !== undefined && String(r.suggestedValue).trim() !== "") map[r.key] = String(r.suggestedValue);
      }
      if (Object.keys(map).length>0) scenarioSuggested = map;
    }
    if (scenarioOverrides) console.log(`[web:dataOverrides] scenario=${vc.displayId} overrides=${Object.keys(scenarioOverrides).join(",")}`);
    workflowResult = await runCaseDiscoveryWorkflow({
      scenario,
      headed: args.headed,
      executionSource,
      outputDir,
      autoPromote: args.autoPromote,
      promotionDryRun: args.dryRun,
      promotionStrict: true,
      requirePromotionApproval: false,
      overwrite: args.overwrite,
      autoPom: args.autoPom,
      testRailClient: trClient,
      appProfile: appProfileObj,
      config: discoveryConfig,
      runId: evidenceRunId,
      scenarioDataOverrides: scenarioOverrides,
      scenarioSuggestedData: scenarioSuggested,
    } as any);

    const discoveryStatus = workflowResult.caseResult.status;
    const completion = resolvePreviewCompletion(workflowResult, args.autoPromote);
    const isPassed = completion.eventStatus === "passed";
    const eventStatus = completion.eventStatus;

    console.log(`[preview-status-map] discoveryStatus=${discoveryStatus} eventStatus=${eventStatus} automationReady=${completion.automationReady} reason=${completion.reason}`);

    // Build compact step results projection (no secrets, no form values)
    const cr = workflowResult.caseResult;
    const stepResults = (cr.steps || []).map(s => ({
      stepIndex: s.index,
      action: s.action ?? undefined,
      target: s.targetText ?? undefined,
      status: s.status ?? undefined,
      reason: s.error ?? undefined,
      evidencePath: s.evidencePath ?? undefined,
    }));

    // Emit JSON line for progress tracking
    console.log(JSON.stringify({
      type: "case_finished",
      caseId: vc.displayId,
      status: eventStatus,
      discoveryStatus,
      specGenerationStatus: completion.specGenerationStatus,
      automationReady: completion.automationReady,
      promotionAllowed: completion.promotionAllowed,
      specWritten: completion.specWritten,
      finalSpecOrigin: completion.finalSpecOrigin,
      fallbackUsed: completion.fallbackUsed,
      aiInvoked: completion.aiInvoked,
      aiAttempts: completion.aiAttempts,
      specGenerationAttempts: completion.specGenerationAttempts,
      specRepairAttempts: completion.specRepairAttempts,
      firstPassPromotion: completion.firstPassPromotion,
      oracleTypes: completion.oracleTypes,
      provider: completion.provider,
      model: completion.model,
      failedAtStep: cr.failedAtStep,
      failedTarget: cr.failedTarget,
      failedReason: cr.failedReason,
      evidenceDir: cr.evidenceDir,
      stepResults,
    }));
    console.log(`[case-finished-enriched] caseId=${vc.displayId} hasFailedAtStep=${cr.failedAtStep != null} hasFailedTarget=${cr.failedTarget != null} hasFailedReason=${cr.failedReason != null} hasEvidenceDir=${cr.evidenceDir != null} stepResults=${stepResults.length}`);

    console.log(`[discovery:preview] completed ${vc.displayId} status=${eventStatus} discoveryStatus=${discoveryStatus}`);

    const failedSteps = workflowResult.caseResult.steps.filter(
      (s) => s.status !== "found" && s.status !== "satisfied_by_previous_assertion" && s.status !== "satisfied_by_children" && s.status !== "skipped" && s.status !== "skipped_after_completion" && s.status !== "skipped_redundant"
    );

    const isAssertionStep = (action: string): boolean => {
      const act = action.toLowerCase();
      if (["asserttext", "assertvisible", "assertexists"].includes(act.replace(/\s+/g, ""))) return true;
      return /\b(validar|verificar|assert|visible|mostrar|muestra|show|confirmacion|confirmation|detalle|resumen|formulario|catalogo|catalog|carrito|cart)\b/i.test(action);
    };

    const failedTargets = failedSteps
      .filter((s) => !isAssertionStep(s.action))
      .map((s) => s.targetText ?? s.action);

    const failedAssertions = failedSteps
      .filter((s) => isAssertionStep(s.action))
      .map((s) => s.targetText ?? s.action);

    // Extract assertion recovery metadata from steps
    const assertionRecoverySteps = failedSteps.filter((s) => isAssertionStep(s.action));
    const recoveryAttempts = assertionRecoverySteps.flatMap((s) => (s as any).recoveryAttempts ?? []);
    const recoveredBy = assertionRecoverySteps.find((s) => (s as any).recoveredBy)?.recoveredBy;
    const assertionImportance = assertionRecoverySteps.find((s) => (s as any).assertionImportance)?.assertionImportance;
    const conditionalAssertion = assertionRecoverySteps.some((s) => (s as any).conditionalAssertion);
    const conditionalRisk = assertionRecoverySteps.find((s) => (s as any).conditionalRisk)?.conditionalRisk;

    const failedCaseResult = {
      id: vc.id,
      caseId: vc.displayId,
      displayId: vc.displayId,
      title: vc.title,
      status: eventStatus,
      discoveryStatus: workflowResult.caseResult.status,
      promotionStatus: workflowResult.promotionStatus,
      promotionReason: (workflowResult as any).promotionReason ?? "",
      specGenerationStatus: completion.specGenerationStatus,
      automationReady: completion.automationReady,
      specWritten: completion.specWritten,
      promotionAllowed: completion.promotionAllowed,
      finalSpecOrigin: completion.finalSpecOrigin,
      fallbackUsed: completion.fallbackUsed,
      aiInvoked: completion.aiInvoked,
      aiAttempts: completion.aiAttempts,
      specGenerationAttempts: completion.specGenerationAttempts,
      specRepairAttempts: completion.specRepairAttempts,
      firstPassPromotion: completion.firstPassPromotion,
      oracleTypes: completion.oracleTypes,
      provider: completion.provider,
      model: completion.model,
      failedTargets,
      failedAssertions,
      assertionRecovery: {
        recovered: Boolean(recoveredBy),
        decision: recoveredBy,
        attempts: recoveryAttempts.length > 0 ? recoveryAttempts : undefined,
      },
      assertionImportance,
      conditionalAssertion,
      conditionalRisk,
      reviewNeededReason: conditionalAssertion && conditionalRisk === "high" ? "conditional_assertion_without_data" : undefined,
      appSlug,
      routeProfileUsed: Boolean(vc.routeProfile),
      outputDir: workflowResult.outputDir,
      specPath: workflowResult.specPath,
      durationMs: workflowResult.durationMs,
    } as any;

    console.log(`[preview-case-finish] caseId=${vc.displayId} eventStatus=${eventStatus} emitted=true duplicate=false`);

    if (isPassed) {
      return failedCaseResult;
    }

    const classifiedFailure = classifyPreviewFailure(failedCaseResult);
    return {
      ...failedCaseResult,
      failureType: classifiedFailure.failureType,
      phase: classifiedFailure.phase,
    } as any;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[discovery:preview] ${vc.displayId} failed: ${message}`);

    // Emit JSON line for progress tracking
    const crCatch = (workflowResult as any)?.caseResult;
    console.log(JSON.stringify({
      type: "case_finished",
      caseId: vc.displayId,
      status: "failed",
      error: message,
      rawError: message,
      failedReason: "execution_exception",
      ...(crCatch?.evidenceDir ? { evidenceDir: crCatch.evidenceDir } : {}),
      ...(crCatch?.steps?.length ? {
        stepResults: crCatch.steps.map((s: any) => ({
          stepIndex: s.index,
          action: s.action ?? undefined,
          target: s.targetText ?? undefined,
          status: s.status ?? undefined,
          reason: s.error ?? undefined,
          evidencePath: s.evidencePath ?? undefined,
        }))
      } : {}),
    }));

    const failedCaseResult = {
      id: vc.id,
      caseId: vc.displayId,
      displayId: vc.displayId,
      title: vc.title,
      status: "failed",
      error: message,
      appSlug,
      routeProfileUsed: Boolean(vc.routeProfile),
      failedTargets: [],
      failedAssertions: [],
    } as any;

    const classifiedFailure = classifyPreviewFailure(failedCaseResult);
    return {
      ...failedCaseResult,
      failureType: classifiedFailure.failureType,
      phase: classifiedFailure.phase,
    } as any;
  }
}

const TECHNICAL_SLUGS = new Set(["tests", "test", "default", "unknown", "undefined", "null"]);

async function consolidateRunEvidence(
  runId: string,
  appSlug: string,
  sectionSlug: string | undefined,
  sectionName: string | undefined,
  results: Array<{ caseId?: string; displayId?: string; status?: string }>,
): Promise<void> {
  try {
    const evidenceConfig = loadEvidenceConfig();
    if (!evidenceConfig.enabled || !evidenceConfig.docxEnabled) {
      console.log(`[evidence:run] skipped runId=${runId} reason=evidence_disabled`);
      return;
    }

    console.log(`[evidence:run] starting consolidation runId=${runId} appSlug=${appSlug} sectionSlug=${sectionSlug || "default-section"}`);

    const runRecorder = new RunEvidenceRecorder({
      appSlug,
      sectionSlug: sectionSlug || "default-section",
      sectionName,
      runId,
    });

    await runRecorder.start();

    // Scan evidence directory for scenario evidence.json files
    const evidenceRoot = evidenceConfig.outputRoot;
    const sectionSlugNormalized = sectionSlug || "default-section";
    const runDir = path.join(evidenceRoot, appSlug, sectionSlugNormalized, "runs", runId, "scenarios");

    console.log(`[evidence:run] searching for scenarios in runDir=${runDir}`);

    const fsSync = await import("node:fs");
    if (fsSync.existsSync(runDir)) {
      const scenarioDirs = fsSync.readdirSync(runDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      console.log(`[evidence:run] found ${scenarioDirs.length} scenario directories: ${scenarioDirs.join(", ")}`);

      for (const scenarioDir of scenarioDirs) {
        const evidenceJsonPath = path.join(runDir, scenarioDir, "evidence.json");
        if (fsSync.existsSync(evidenceJsonPath)) {
          console.log(`[evidence:run] loading scenario evidence from ${evidenceJsonPath}`);
          await runRecorder.addScenarioFromFile(evidenceJsonPath);
        } else {
          console.log(`[evidence:run] evidence.json not found in ${scenarioDir}`);
        }
      }
    } else {
      console.log(`[evidence:run] runDir does not exist: ${runDir}`);
    }

    if (results.length > 0) {
      console.log(`[evidence:run] applying ${results.length} status overrides from preview results`);
      for (const result of results) {
        const scenarioId = result.displayId ?? result.caseId;
        if (!scenarioId || !result.status) continue;
        runRecorder.overrideScenarioStatus(scenarioId, result.status, "case_finished");
      }
    }

    await runRecorder.finish();
    console.log(`[evidence:run] consolidated runId=${runId} appSlug=${appSlug} sectionSlug=${sectionSlugNormalized}`);
  } catch (err: any) {
    console.log(`[evidence:run] consolidation failed runId=${runId}: ${err.message}`);
  }
}

function isTechnicalSlug(slug: string): boolean {
  return TECHNICAL_SLUGS.has(slug.trim().toLowerCase());
}

async function hasValidAppConfig(slug: string): Promise<boolean> {
  try {
    const configPath = path.resolve(`automations/apps/${slug}/app.config.json`);
    const stat = await fs.stat(configPath).catch(() => null);
    if (!stat) return false;
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    const rp = config.routeProfile;
    return rp && typeof rp === "object" && (Object.keys(rp.domainTerms ?? {}).length > 0 || (rp.entry ?? []).length > 0);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parsePreviewArgs(process.argv.slice(2));

  if (args.help) {
    printPreviewHelp();
    return;
  }

  // Read EVIDENCE_RUN_ID from environment (set by scenario-preview-runner)
  // If not set, generate one for standalone mode
  let evidenceRunId = process.env.EVIDENCE_RUN_ID;
  let runIdMode = "qalab";

  if (!evidenceRunId) {
    // Generate runId for standalone execution
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    evidenceRunId = `preview-${timestamp}`;
    runIdMode = "standalone_generated";
  }
  const executionSource: "qalab" | "cli" = runIdMode === "qalab" ? "qalab" : "cli";

  console.log(`[discovery:preview] evidenceRunId=${evidenceRunId} mode=${runIdMode}`);
  console.log(`[discovery:preview] app=${args.app}`);
  console.log("[discovery:preview] Starting preview execution");
  console.log(`[discovery:preview] input=${args.input}`);
  console.log(`[discovery:preview] app=${args.app}`);
  console.log(`[discovery:preview] headed=${args.headed}`);
  console.log(`[discovery:preview] autoPromote=${args.autoPromote}`);
  console.log(`[discovery:preview] autoPom=${args.autoPom}`);
  console.log(`[discovery:preview] overwrite=${args.overwrite}`);
  console.log(`[discovery:preview] deferEvidenceConsolidation=${args.deferEvidenceConsolidation}`);

  // Load virtual cases
  const cases = await loadVirtualCases(args.input);
  console.log(`[discovery:preview] loaded ${cases.length} virtual cases`);
  console.log(`[discovery:preview] app=${args.app}`);

  // ── FASE 2 (CLI): Block technical slugs without valid routeProfile ──
  if (isTechnicalSlug(args.app)) {
    const appConfigValid = await hasValidAppConfig(args.app);
    if (!appConfigValid) {
      // Try to use VC's own appSlug as fallback
      const vcAppSlugs = [...new Set(cases.map((c) => c.appSlug).filter(Boolean))];
      let validSlug: string | undefined;
      for (const s of vcAppSlugs) {
        if (!isTechnicalSlug(s) && await hasValidAppConfig(s)) {
          validSlug = s;
          break;
        }
      }
      if (validSlug) {
        console.log(`[discovery:preview] CLI appSlug "${args.app}" is technical; falling back to VC appSlug "${validSlug}"`);
        args.app = validSlug;
      } else {
        const errorMessage = `AppSlug "${args.app}" is a technical/environment slug with no valid routeProfile. ` +
          `Provide a valid functional app slug via --app.`;
        console.error(`[discovery:preview] Error: ${errorMessage}`);
        // Write results.json with error
        const resultsPath = path.join(path.dirname(args.input), "results.json");
        await fs.writeFile(resultsPath, JSON.stringify({
          ok: false, error: "invalid_target_app_slug", message: errorMessage,
        }, null, 2), "utf-8");
        process.exit(1);
      }
    }
  }

  // Resolve app profile
  const { resolvedAppSlug, appProfileObj } = await resolvePreviewAppProfile(args.app);

  // ── [web:base-url] Fail-closed resolution — appSlug → app_config → baseUrl must be preserved ──
  let webBase: { effective: string; source: string; fallbackUsed: boolean };
  try {
    webBase = resolveWebBaseUrl(resolvedAppSlug);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    const resultsPath = path.join(path.dirname(args.input), "results.json");
    await fs.writeFile(resultsPath, JSON.stringify({ ok: false, error: "missing_base_url", message }, null, 2), "utf-8");
    process.exit(1);
  }

  // Execute each case in series
  const results: PreviewResult["cases"] = [];
  let passed = 0;
  let failed = 0;
  let automationReady = 0;
  let specsPromoted = 0;

  for (let i = 0; i < cases.length; i++) {
    const vc = cases[i];
    const result = await runPreviewCase(vc, args, resolvedAppSlug, appProfileObj, i, cases.length, evidenceRunId, executionSource, webBase.effective);
    results.push(result);
    if (result.status === "passed") passed++;
    else failed++;
    if ((result as PreviewCaseResult).automationReady) automationReady += 1;
    if ((result as PreviewCaseResult).specWritten) specsPromoted += 1;
  }

  // Consolidate run evidence into single DOCX unless an upstream orchestrator requested deferral
  if (args.deferEvidenceConsolidation) {
    console.log(`[evidence:run] skipped runId=${evidenceRunId} reason=deferred_consolidation`);
  } else {
    const firstCase = cases[0];
    const sectionSlug = firstCase?.sectionSlug;
    const sectionName = firstCase?.sectionName;
    await consolidateRunEvidence(evidenceRunId, resolvedAppSlug, sectionSlug, sectionName, results);
  }

  // Aggregate failure groups (FASE 5)
  const failureGroups = buildPreviewFailureGroups(results);
  const report = buildPreviewSummaryReport(results as PreviewCaseResult[], cases.length, failureGroups);

  const result: PreviewResult & { failureGroups?: typeof failureGroups } = {
    ok: failed === 0,
    total: cases.length,
    passed,
    failed,
    cases: results,
    summary: {
      total: cases.length,
      completed: results.length,
      passed,
      failed,
      automationReady,
      specsPromoted,
      passRate: report.passRate,
      failureGroups,
      dominantFailure: report.dominantFailure,
      nextFix: report.nextFix,
    } as any,
    failureGroups,
    results: results,
    topFailedCases: report.topFailedCases,
    dominantFailure: report.dominantFailure,
    nextFix: report.nextFix,
  };

  // Write results
  const outputDir = path.dirname(args.input);
  const resultsPath = path.join(outputDir, "results.json");
  await fs.writeFile(resultsPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`\n[discovery:preview] Results: ${passed} passed, ${failed} failed out of ${cases.length}`);
  if (args.autoPromote) {
    console.log(`[discovery:preview] automationReady=${automationReady} specsPromoted=${specsPromoted} total=${cases.length}`);
  }
  console.log(`[discovery:preview] Results saved to ${resultsPath}`);

  if (failed > 0) {
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("discovery-preview.ts");
if (isMainModule) {
  main().catch((err) => {
    console.error(`[discovery:preview] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
