import path from "node:path";
import fs from "node:fs/promises";
import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { runCaseDiscoveryWorkflow } from "../discovery/case-discovery-workflow";
import { getCaseAutomationStatus } from "../cases/case-automation-status";
import { runCaseExecutionQueue } from "../runner/case-execution-queue";
import type { CaseDiscoveryWorkflowOptions, CaseDiscoveryWorkflowResult } from "../discovery/case-discovery-workflow";
import type { QueueItemContext } from "../runner/case-execution-queue";
import type { PendingAssertionForensics, BatchCaseRootCause } from "../types/discovery.types";
import { ensureAppStructure, logAppProfile, resolveAppProfile, type AppProfile } from "../automations/app-profile";
import { buildAiRepairBatchSummary, formatAiRepairBatchConsoleOutput } from "../ai/repair/ai-repair-summary-builder";
import { writeJsonSafe } from "../utils/json-utils";
import type { AiRepairCaseSummary } from "../ai/repair/ai-repair-metrics";

export type BatchCaseMode = "all" | "not-automated" | "by-ids" | "by-range";

export type BatchCliArgs = {
  mode: BatchCaseMode;
  app?: string;
  caseIds: number[];
  from?: number;
  to?: number;
  limit?: number;
  headed: boolean;
  autoPromote: boolean;
  promotionDryRun: boolean;
  promotionStrict: boolean;
  requirePromotionApproval: boolean;
  dryRun: boolean;
  includeActive: boolean;
  rerunActive: boolean;
  stopOnFail: boolean;
  concurrency: number;
  parallel: boolean;
  autoRepair: boolean;
  repairTimeoutMs: number;
  showAgentLog: boolean;
  continueOnAgentTimeout: boolean;
  compactAgentPrompt: boolean;
  agentPromptBudgetSeconds?: number;
  agentMaxCandidates?: number;
  agentMaxProposedActions?: number;
  agentMaxAttempts?: number;
  pageObjectMode: boolean;
  inlineDebugSpec: boolean;
  allowPageObjectCandidates: boolean;
  overwrite: boolean;
  autoPom: boolean;
  autoPomThreshold?: number;
  noAutoPomValidation: boolean;
};

export type BatchCaseState =
  | "selected"
  | "skipped_active"
  | "skipped_filter"
  | "running"
  | "discovered_passed"
  | "repaired_passed"
  | "discovered_partial"
  | "exploration_failed"
  | "failed"
  | "promoted"
  | "promotion_failed"
  | "not_promoted";

export type BatchCaseResultEntry = {
  caseId: number;
  title: string;
  selected: boolean;
  activeAtSelection?: boolean;
  skipReason?: string;
  status: BatchCaseState;
  promoted: boolean;
  promotionStatus?: string;
  outputDir?: string;
  evidenceDir?: string;
  specPath?: string;
  failureReason?: string;
  durationMs?: number;
  rootCauseCategory?: BatchCaseRootCause;
  topPendingAssertions?: string[];
  autoRepairCalled?: boolean;
  pendingAssertionForensics?: PendingAssertionForensics[];
  pendingAssertionCount?: number;
  notConsumedReasons?: string[];
  autoRepairReason?: string;
  localClosureConsumedCount?: number;
  previousStatus?: string;
  finalStatus?: string;
  finalStatusReason?: string;
  pendingBefore?: number;
  pendingAfter?: number;
  promotionEligible?: boolean;
  discoveryResult?: import("../discovery/case-discovery-workflow").CaseDiscoveryWorkflowResult["caseResult"];
};

export type BatchResult = {
  batchId: string;
  timestamp: string;
  args: {
    mode: BatchCaseMode;
    app?: string;
    caseIds: number[];
    from?: number;
    to?: number;
    limit?: number;
    headed: boolean;
    autoPromote: boolean;
    promotionDryRun: boolean;
    promotionStrict: boolean;
    requirePromotionApproval: boolean;
    dryRun: boolean;
    includeActive: boolean;
    rerunActive: boolean;
    stopOnFail: boolean;
    concurrency: number;
    parallel: boolean;
    autoRepair: boolean;
    repairTimeoutMs: number;
    showAgentLog: boolean;
    continueOnAgentTimeout: boolean;
  };
  cases: BatchCaseResultEntry[];
  skippedCases: Array<{ caseId: number; reason: string }>;
  rerunActiveCases: Array<{ caseId: number }>;
  summary: {
    requested: number;
    selected: number;
    executed: number;
    skipped: number;
    passed: number;
    failed: number;
    promoted: number;
    alreadyActiveSkipped: number;
    activeRerun: number;
    promotionFailed: number;
    notPromoted: number;
    totalDurationMs: number;
  };
  aiRepairBatchSummary?: import("../ai/repair/ai-repair-metrics").AiRepairBatchSummary;
};

export function parseBatchArgs(argv: string[]): BatchCliArgs {
  const args: BatchCliArgs = {
    mode: "all",
    app: undefined,
    caseIds: [],
    headed: false,
    autoPromote: false,
    promotionDryRun: false,
    promotionStrict: false,
    requirePromotionApproval: false,
    dryRun: false,
    includeActive: false,
    rerunActive: false,
    stopOnFail: false,
    concurrency: 1,
    parallel: false,
    autoRepair: false,
    repairTimeoutMs: 120000,
    showAgentLog: false,
    continueOnAgentTimeout: true,
    compactAgentPrompt: false,
    pageObjectMode: true,
    inlineDebugSpec: false,
    allowPageObjectCandidates: true,
    overwrite: false,
    autoPom: false,
    autoPomThreshold: undefined,
    noAutoPomValidation: false
  };

  let modeSet = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--headed") {
      args.headed = true;
      continue;
    }
    if (token === "--app") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --app");
      }
      args.app = nextValue;
      i += 1;
      continue;
    }
    if (token === "--auto-promote") {
      args.autoPromote = true;
      continue;
    }
    if (token === "--promotion-dry-run") {
      args.promotionDryRun = true;
      continue;
    }
    if (token === "--promotion-strict") {
      args.promotionStrict = true;
      continue;
    }
    if (token === "--require-promotion-approval") {
      args.requirePromotionApproval = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--include-active") {
      args.includeActive = true;
      continue;
    }
    if (token === "--rerun-active") {
      args.includeActive = true;
      args.rerunActive = true;
      continue;
    }
    if (token === "--stop-on-fail") {
      args.stopOnFail = true;
      continue;
    }
    if (token === "--parallel") {
      args.parallel = true;
      continue;
    }
    if (token === "--auto-repair") {
      args.autoRepair = true;
      continue;
    }
    if (token === "--show-agent-log") {
      args.showAgentLog = true;
      continue;
    }
    if (token === "--compact-agent-prompt") {
      args.compactAgentPrompt = true;
      continue;
    }
    if (token === "--page-object-mode") {
      args.pageObjectMode = true;
      continue;
    }
    if (token === "--inline-debug-spec") {
      args.inlineDebugSpec = true;
      continue;
    }
    if (token === "--allow-page-object-candidates") {
      args.allowPageObjectCandidates = true;
      continue;
    }
    if (token === "--no-page-object-mode") {
      args.pageObjectMode = false;
      continue;
    }
    if (token === "--no-page-object-candidates") {
      args.allowPageObjectCandidates = false;
      continue;
    }
    if (token === "--overwrite") {
      args.overwrite = true;
      continue;
    }
    if (token === "--auto-pom") {
      args.autoPom = true;
      continue;
    }
    if (token === "--auto-pom-threshold") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --auto-pom-threshold");
      }
      args.autoPomThreshold = Number(nextValue);
      if (!Number.isFinite(args.autoPomThreshold) || args.autoPomThreshold < 0 || args.autoPomThreshold > 1) {
        throw new Error(`Invalid --auto-pom-threshold value: ${nextValue}. Expected a number between 0 and 1.`);
      }
      i += 1;
      continue;
    }
    if (token === "--no-auto-pom-validation") {
      args.noAutoPomValidation = true;
      continue;
    }

    if (token === "--continue-on-agent-timeout") {
      args.continueOnAgentTimeout = true;
      continue;
    }
    if (token === "--agent-prompt-budget-seconds") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --agent-prompt-budget-seconds");
      }
      const val = Number(nextValue);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error(`Invalid --agent-prompt-budget-seconds value: ${nextValue}. Expected a positive integer.`);
      }
      args.agentPromptBudgetSeconds = val;
      i += 1;
      continue;
    }
    if (token === "--agent-max-candidates") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --agent-max-candidates");
      }
      const val = Number(nextValue);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error(`Invalid --agent-max-candidates value: ${nextValue}. Expected a positive integer.`);
      }
      args.agentMaxCandidates = val;
      i += 1;
      continue;
    }
    if (token === "--agent-max-proposed-actions") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --agent-max-proposed-actions");
      }
      const val = Number(nextValue);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error(`Invalid --agent-max-proposed-actions value: ${nextValue}. Expected a positive integer.`);
      }
      args.agentMaxProposedActions = val;
      i += 1;
      continue;
    }
    if (token === "--agent-max-attempts") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --agent-max-attempts");
      }
      const val = Number(nextValue);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error(`Invalid --agent-max-attempts value: ${nextValue}. Expected a positive integer.`);
      }
      args.agentMaxAttempts = val;
      i += 1;
      continue;
    }
    if (token === "--repair-timeout-ms") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --repair-timeout-ms");
      }
      const ms = Number(nextValue);
      if (!Number.isFinite(ms) || ms <= 0) {
        throw new Error(`Invalid --repair-timeout-ms value: ${nextValue}. Expected a positive integer.`);
      }
      args.repairTimeoutMs = ms;
      i += 1;
      continue;
    }
    if (token === "--all") {
      if (modeSet) throw new Error("Mode already set. Choose one of --all, --not-automated, --case-ids, --from/--to.");
      args.mode = "all";
      modeSet = true;
      continue;
    }
    if (token === "--not-automated") {
      if (modeSet) throw new Error("Mode already set. Choose one of --all, --not-automated, --case-ids, --from/--to.");
      args.mode = "not-automated";
      modeSet = true;
      continue;
    }
    if (token === "--case-ids") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --case-ids");
      }
      if (modeSet) throw new Error("Mode already set. Choose one of --all, --not-automated, --case-ids, --from/--to.");
      args.mode = "by-ids";
      args.caseIds = nextValue.split(",").map((s) => {
        const id = Number(s.trim().replace(/^C/i, ""));
        if (!Number.isFinite(id) || id <= 0) {
          throw new Error(`Invalid case ID in --case-ids: ${s}`);
        }
        return id;
      });
      modeSet = true;
      i += 1;
      continue;
    }
    if (token === "--from") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --from");
      }
      if (modeSet) throw new Error("Mode already set. Choose one of --all, --not-automated, --case-ids, --from/--to.");
      args.mode = "by-range";
      const from = Number(nextValue.replace(/^C/i, ""));
      if (!Number.isFinite(from) || from <= 0) {
        throw new Error(`Invalid --from value: ${nextValue}`);
      }
      args.from = from;
      modeSet = true;
      i += 1;
      continue;
    }
    if (token === "--to") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --to");
      }
      const to = Number(nextValue.replace(/^C/i, ""));
      if (!Number.isFinite(to) || to <= 0) {
        throw new Error(`Invalid --to value: ${nextValue}`);
      }
      args.to = to;
      i += 1;
      continue;
    }
    if (token === "--limit") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --limit");
      }
      const limit = Number(nextValue);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`Invalid --limit value: ${nextValue}. Expected a positive integer.`);
      }
      args.limit = limit;
      i += 1;
      continue;
    }
    if (token === "--concurrency") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --concurrency");
      }
      const c = Number(nextValue);
      if (!Number.isFinite(c) || c <= 0) {
        throw new Error(`Invalid --concurrency value: ${nextValue}. Expected a positive integer.`);
      }
      args.concurrency = c;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.headed) {
    args.concurrency = 1;
    args.parallel = false;
  }

  if (!args.parallel && args.concurrency > 1) {
    args.concurrency = 1;
  }

  return args;
}

export async function selectCases(
  client: TestRailClient,
  args: BatchCliArgs
): Promise<BatchCaseResultEntry[]> {
  const projectId = config.integrations.testRail?.projectId;
  if (!projectId) {
    throw new Error("TESTRAIL_PROJECT_ID is not configured.");
  }
  const suiteId = config.integrations.testRail?.suiteId;
  const sectionId = config.integrations.testRail?.sectionId;

  let rawCases = await client.getCases(projectId, suiteId, sectionId);

  if (args.mode === "by-range" && args.from !== undefined && args.to !== undefined) {
    rawCases = rawCases.filter((c) => c.id >= args.from! && c.id <= args.to!);
  } else if (args.mode === "by-ids" && args.caseIds.length > 0) {
    const idSet = new Set(args.caseIds);
    rawCases = rawCases.filter((c) => idSet.has(c.id));
  }

  if (rawCases.length === 0) {
    return [];
  }

  const statusResult = await getCaseAutomationStatus(rawCases);

  const statusMap = new Map(statusResult.cases.map((c) => [c.caseId, c.automationStatus]));

  const entries: BatchCaseResultEntry[] = [];
  for (const tc of rawCases) {
    const status = statusMap.get(tc.id) ?? "not_automated";

    if (args.mode === "not-automated" && status !== "not_automated") {
      entries.push({
        caseId: tc.id,
        title: tc.title,
        selected: false,
        skipReason: "not_not_automated",
        status: "skipped_filter",
        promoted: false
      });
      continue;
    }

    if (!args.includeActive && status === "active") {
      entries.push({
        caseId: tc.id,
        title: tc.title,
        selected: false,
        activeAtSelection: true,
        skipReason: "already_active",
        status: "skipped_active",
        promoted: false
      });
      continue;
    }

    entries.push({
      caseId: tc.id,
      title: tc.title,
      selected: true,
      activeAtSelection: status === "active",
      status: "selected",
      promoted: false
    });
  }

  const selectedEntries = entries.filter((e) => e.selected);

  if (args.limit !== undefined && args.limit > 0 && selectedEntries.length > args.limit) {
    const kept = selectedEntries.slice(0, args.limit);
    const removed = selectedEntries.slice(args.limit);
    for (const r of removed) {
      const idx = entries.indexOf(r);
      if (idx !== -1) {
        entries[idx] = { ...entries[idx], selected: false, skipReason: "limit_reached", status: "skipped_filter" };
      }
    }
  }

  return entries;
}

export async function executeBatch(
  args: BatchCliArgs,
  entries: BatchCaseResultEntry[],
  appProfile?: AppProfile
): Promise<BatchResult> {
  const batchId = new Date().toISOString().replace(/[:.]/g, "-");
  const batchDir = path.resolve(`./.artifacts/discovery/batch/${batchId}`);
  await fs.mkdir(path.join(batchDir, "cases"), { recursive: true });

  const selected = entries.filter((e) => e.selected);

  if (args.dryRun || selected.length === 0) {
    const startTime = Date.now();
    
    // Generate empty AI Repair batch summary for dry-run
    const aiRepairBatchSummary = buildAiRepairBatchSummary([]);
    console.log("");
    console.log(formatAiRepairBatchConsoleOutput(aiRepairBatchSummary));
    
    const result: BatchResult = {
      batchId,
      timestamp: new Date().toISOString(),
      args: serializeArgs(args),
      cases: entries,
      skippedCases: entries.filter((e) => !e.selected && e.skipReason).map((e) => ({ caseId: e.caseId, reason: e.skipReason! })),
      rerunActiveCases: args.rerunActive
        ? entries.filter((e) => e.selected && e.activeAtSelection).map((e) => ({ caseId: e.caseId }))
        : [],
      summary: {
        selected: selected.length,
        requested: entries.length,
        executed: 0,
        skipped: entries.length - selected.length,
        passed: 0,
        failed: 0,
        promoted: 0,
        alreadyActiveSkipped: entries.filter((e) => e.status === "skipped_active").length,
        activeRerun: args.rerunActive ? entries.filter((e) => e.selected).length : 0,
        promotionFailed: 0,
        notPromoted: 0,
        totalDurationMs: Date.now() - startTime
      },
      aiRepairBatchSummary
    };
    result.skippedCases = entries.filter((e) => !e.selected && e.skipReason).map((e) => ({ caseId: e.caseId, reason: e.skipReason! }));
    result.rerunActiveCases = args.rerunActive
      ? entries.filter((e) => e.selected).map((e) => ({ caseId: e.caseId }))
      : [];

    await writeBatchArtifacts(batchDir, result);
    return result;
  }

  const testRailRuntimeConfig = requireTestRailConfig(config);
  const sharedClient = new TestRailClient(testRailRuntimeConfig);

  async function runSingleCase(entry: BatchCaseResultEntry, _ctx: QueueItemContext): Promise<BatchCaseResultEntry> {
    const caseStartTime = Date.now();
    console.log(`[discovery:batch] Running case C${entry.caseId} - ${entry.title}`);

    const caseOutputDir = path.join(batchDir, "cases", `case-${entry.caseId}`);
    const workflowOptions: CaseDiscoveryWorkflowOptions = {
      caseId: entry.caseId,
      headed: args.headed,
      outputDir: caseOutputDir,
      autoPromote: args.autoPromote,
      promotionDryRun: args.promotionDryRun,
      promotionStrict: args.promotionStrict,
      requirePromotionApproval: args.requirePromotionApproval,
      pageObjectMode: args.pageObjectMode,
      inlineDebugSpec: args.inlineDebugSpec,
      allowPageObjectCandidates: args.allowPageObjectCandidates,
      overwrite: args.overwrite,
      autoPom: args.autoPom,
      autoPomThreshold: args.autoPomThreshold,
      noAutoPomValidation: args.noAutoPomValidation,
      config,
      testRailClient: sharedClient,
      autoRepair: args.autoRepair,
      repairTimeoutMs: args.repairTimeoutMs,
      showAgentLog: args.showAgentLog,
      continueOnAgentTimeout: args.continueOnAgentTimeout,
      compactAgentPrompt: args.compactAgentPrompt,
      agentPromptBudgetSeconds: args.agentPromptBudgetSeconds,
      agentMaxCandidates: args.agentMaxCandidates,
      agentMaxProposedActions: args.agentMaxProposedActions,
      agentMaxAttempts: args.agentMaxAttempts,
      appProfile
    };

    const workflowResult: CaseDiscoveryWorkflowResult = await runCaseDiscoveryWorkflow(workflowOptions);
    const durationMs = Date.now() - caseStartTime;
    const cr = workflowResult.caseResult;

    let state: BatchCaseState;
    if (cr.status === "discovered_passed" || cr.status === "repaired_passed") {
      state = cr.status;
    } else if (cr.status === "discovered_partial") {
      state = "discovered_partial";
    } else if (cr.status === "exploration_failed") {
      state = "exploration_failed";
    } else {
      state = "failed";
    }

    if (workflowResult.promoted) {
      state = "promoted";
    } else if (workflowResult.promotionStatus === "promotion_failed") {
      state = "promotion_failed";
    } else if (workflowResult.promotionStatus === "not_promoted") {
      state = "not_promoted";
    }

    const resultEntry: BatchCaseResultEntry = {
      caseId: entry.caseId,
      title: entry.title,
      selected: true,
      status: state,
      promoted: workflowResult.promoted,
      promotionStatus: workflowResult.promotionStatus,
      outputDir: workflowResult.outputDir,
      evidenceDir: workflowResult.evidenceDir,
      specPath: workflowResult.specPath,
      failureReason: cr.failedReason,
      durationMs,
      rootCauseCategory: cr.rootCauseCategory,
      topPendingAssertions: cr.partialDiagnostics?.pendingAssertions?.slice(0, 5),
      autoRepairCalled: Boolean(cr.autoRepairDecisionDiagnostics?.attempted && !cr.autoRepairDecisionDiagnostics?.skipped),
      pendingAssertionForensics: (cr as any).partialDiagnostics?.pendingForensics,
      pendingAssertionCount: cr.partialDiagnostics?.pendingAssertions?.length ?? 0,
      notConsumedReasons: ((cr as any).partialDiagnostics?.pendingForensics ?? [])
        .map((f: PendingAssertionForensics) => f.notConsumedReason)
        .filter(Boolean),
      autoRepairReason: cr.autoRepairDecisionDiagnostics?.autoRepairReason,
      localClosureConsumedCount: cr.autoRepairDecisionDiagnostics?.localClosureConsumed?.length ?? 0,
      previousStatus: cr.finalStatusReconciliation?.previousStatus,
      finalStatus: cr.finalStatusReconciliation?.newStatus ?? cr.status,
      finalStatusReason: cr.finalStatusReconciliation?.reason,
      pendingBefore: cr.finalStatusReconciliation?.beforePendingAssertionCount,
      pendingAfter: cr.finalStatusReconciliation?.afterPendingAssertionCount,
      promotionEligible: cr.finalStatusReconciliation?.promotionEligible,
      discoveryResult: cr
    };

    console.log(`[discovery:batch] Case C${entry.caseId} finished: ${state} (${durationMs}ms)`);
    return resultEntry;
  }

  const queueResult = await runCaseExecutionQueue<BatchCaseResultEntry, BatchCaseResultEntry>(
    selected,
    async (entry, ctx) => {
      const workerStartedAt = Date.now();
      try {
        return await runSingleCase(entry, ctx);
      } catch (error) {
        const durationMs = Math.max(0, Date.now() - workerStartedAt);
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[discovery:batch] Case C${entry.caseId} failed with error: ${message}`);
        return {
          caseId: entry.caseId,
          title: entry.title,
          selected: true,
          status: "failed" as BatchCaseState,
          promoted: false,
          failureReason: message,
          durationMs
        };
      }
    },
    {
      concurrency: args.concurrency,
      stopOnFailure: args.stopOnFail,
      label: "discovery-batch"
    }
  );

  const results = queueResult.items
    .filter((r) => r.value !== undefined)
    .map((r) => r.value!);

  const skippedFromStop = queueResult.items
    .filter((r) => r.value === undefined && r.error === undefined)
    .map((r) => ({
      ...selected[r.index],
      status: "skipped_filter" as BatchCaseState,
      skipReason: "stopped_on_fail"
    }));

  const allExecutedResults = [...results, ...skippedFromStop];

  const nonSelected = entries.filter((e) => !e.selected);
  const allResults = [...nonSelected, ...allExecutedResults];
  allResults.sort((a, b) => a.caseId - b.caseId);

  const passed = allExecutedResults.filter((r) => r.status === "discovered_passed" || r.status === "repaired_passed").length;
  const failed = allExecutedResults.filter((r) => r.status === "failed" || r.status === "exploration_failed").length;
  const promoted = allExecutedResults.filter((r) => r.promoted).length;
  const promotionFailed = allExecutedResults.filter((r) => r.status === "promotion_failed").length;
  const notPromoted = allExecutedResults.filter((r) => r.status === "not_promoted").length;
  const alreadyActiveSkipped = allResults.filter((r) => r.status === "skipped_active").length;
  const skippedCases = allResults.filter((r) => !r.selected && r.skipReason).map((r) => ({ caseId: r.caseId, reason: r.skipReason! }));
  const rerunActiveCases = args.rerunActive
    ? entries
      .filter((e) => e.selected && e.activeAtSelection)
      .map((e) => ({ caseId: e.caseId }))
    : [];

  // Collect AI Repair summaries from executed cases
  const aiRepairCaseSummaries: Array<{ caseId: string; appSlug: string; summary: AiRepairCaseSummary }> = allExecutedResults
    .filter((r) => r.discoveryResult?.aiRepairSummary)
    .map((r) => ({
      caseId: `C${r.caseId}`,
      appSlug: appProfile?.appSlug ?? "default",
      summary: r.discoveryResult!.aiRepairSummary!
    }));

  // Build batch-level AI Repair summary
  const aiRepairBatchSummary = buildAiRepairBatchSummary(aiRepairCaseSummaries);

  // Save AI Repair batch summary artifact
  const aiRepairBatchSummaryPath = path.join(batchDir, "ai-repair-batch-summary.json");
  await writeJsonSafe(aiRepairBatchSummaryPath, aiRepairBatchSummary);

  // Print AI Repair batch summary to console
  console.log("");
  console.log(formatAiRepairBatchConsoleOutput(aiRepairBatchSummary));

  const batchResult: BatchResult = {
    batchId,
    timestamp: new Date().toISOString(),
    args: serializeArgs(args),
    cases: allResults,
    skippedCases,
    rerunActiveCases,
    summary: {
      requested: entries.length,
      selected: selected.length,
      executed: allExecutedResults.length,
      skipped: allResults.length - allExecutedResults.length,
      passed,
      failed,
      promoted,
      alreadyActiveSkipped,
      activeRerun: args.rerunActive ? selected.length : 0,
      promotionFailed,
      notPromoted,
      totalDurationMs: queueResult.totalDurationMs
    },
    aiRepairBatchSummary
  };

  await writeBatchArtifacts(batchDir, batchResult);

  return batchResult;
}

export async function resolveBatchAppProfile(args: BatchCliArgs): Promise<{ appProfile: AppProfile; baseDir: string }> {
  const resolvedApp = await resolveAppProfile({
    cliAppSlug: args.app,
    envAppSlug: process.env.APP_SLUG,
    testRailProjectId: config.integrations.testRail?.projectId,
    testRailBaseUrl: config.integrations.testRail?.url,
    testRailEmail: config.integrations.testRail?.email,
    testRailApiKey: config.integrations.testRail?.apiKey,
    baseUrl: config.app.baseUrl,
    appName: config.app.name
  });
  const ensured = await ensureAppStructure(resolvedApp.baseDir);
  console.log(`[discovery:batch] App profile resolved: appSlug=${resolvedApp.profile.appSlug} source=${resolvedApp.profile.source}`);
  logAppProfile(resolvedApp.profile, resolvedApp.baseDir, ensured.length > 0 ? ensured : undefined);
  return { appProfile: resolvedApp.profile, baseDir: resolvedApp.baseDir };
}

function serializeArgs(args: BatchCliArgs): BatchResult["args"] {
  return {
    mode: args.mode,
    app: args.app,
    caseIds: args.caseIds,
    from: args.from,
    to: args.to,
    limit: args.limit,
    headed: args.headed,
    autoPromote: args.autoPromote,
    promotionDryRun: args.promotionDryRun,
    promotionStrict: args.promotionStrict,
    requirePromotionApproval: args.requirePromotionApproval,
    dryRun: args.dryRun,
    includeActive: args.includeActive,
    rerunActive: args.rerunActive,
    stopOnFail: args.stopOnFail,
    concurrency: args.concurrency,
    parallel: args.parallel,
    autoRepair: args.autoRepair,
    repairTimeoutMs: args.repairTimeoutMs,
    showAgentLog: args.showAgentLog,
    continueOnAgentTimeout: args.continueOnAgentTimeout
  };
}

async function writeBatchArtifacts(batchDir: string, result: BatchResult): Promise<void> {
  const jsonPath = path.join(batchDir, "batch-result.json");
  await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  const mdLines: string[] = [];
  mdLines.push("# Batch Discovery Summary");
  mdLines.push("");
  mdLines.push(`- **Batch ID:** ${result.batchId}`);
  mdLines.push(`- **Timestamp:** ${result.timestamp}`);
  mdLines.push("");
  mdLines.push("## Arguments");
  mdLines.push("");
  mdLines.push(`- Mode: \`${result.args.mode}\``);
  mdLines.push(`- Headed: ${result.args.headed}`);
  mdLines.push(`- Auto-promote: ${result.args.autoPromote}`);
  mdLines.push(`- Dry-run: ${result.args.dryRun}`);
  mdLines.push(`- Include active: ${result.args.includeActive}`);
  mdLines.push(`- Rerun active: ${result.args.rerunActive}`);
  mdLines.push(`- Stop on fail: ${result.args.stopOnFail}`);
  mdLines.push(`- Concurrency: ${result.args.concurrency}`);
  mdLines.push(`- Parallel: ${result.args.parallel}`);
  if (result.args.limit !== undefined) {
    mdLines.push(`- Limit: ${result.args.limit}`);
  }
  mdLines.push("");
  mdLines.push("## Summary");
  mdLines.push("");
  mdLines.push(`| Metric | Value |`);
  mdLines.push(`|--------|-------|`);
  mdLines.push(`| Selected | ${result.summary.selected} |`);
  mdLines.push(`| Requested | ${result.summary.requested} |`);
  mdLines.push(`| Executed | ${result.summary.executed} |`);
  mdLines.push(`| Skipped | ${result.summary.skipped} |`);
  mdLines.push(`| Passed | ${result.summary.passed} |`);
  mdLines.push(`| Failed | ${result.summary.failed} |`);
  mdLines.push(`| Promoted | ${result.summary.promoted} |`);
  mdLines.push(`| Already active (skipped) | ${result.summary.alreadyActiveSkipped} |`);
  mdLines.push(`| Active rerun | ${result.summary.activeRerun} |`);
  mdLines.push(`| Promotion failed | ${result.summary.promotionFailed} |`);
  mdLines.push(`| Not promoted | ${result.summary.notPromoted} |`);
  mdLines.push(`| Total duration | ${result.summary.totalDurationMs}ms |`);
  mdLines.push("");
  mdLines.push("## Cases");
  mdLines.push("");
  mdLines.push("| Case ID | Title | Status | Final Status | Reconciliation Reason | Promoted | Duration | Final Reason | Root Cause | Pending | Auto-Repair | Auto-Repair Reason | Top Pending |");
  mdLines.push("|---------|-------|--------|--------------|-----------------------|----------|----------|--------------|------------|---------|-------------|--------------------|-------------|");
  for (const c of result.cases) {
    const id = `C${c.caseId}`;
    const title = c.title.replace(/\|/g, "\\|");
    const duration = c.durationMs !== undefined ? `${c.durationMs}ms` : "-";
    const rootCause = c.rootCauseCategory ?? "-";
    const autoRepair = c.autoRepairCalled ? "yes" : "no";
    const finalReason = c.failureReason ?? "-";
    const pendingCount = c.pendingAssertionCount ?? 0;
    const autoRepairReason = c.autoRepairReason ?? "-";
    const topPending = c.topPendingAssertions && c.topPendingAssertions.length > 0 
      ? c.topPendingAssertions.slice(0, 2).map(a => a.replace(/\|/g, " ")).join("; ")
      : "-";
    mdLines.push(`| ${id} | ${title} | ${c.status} | ${c.finalStatus ?? c.status} | ${c.finalStatusReason ?? "-"} | ${c.promoted ? "yes" : "no"} | ${duration} | ${finalReason} | ${rootCause} | ${pendingCount} | ${autoRepair} | ${autoRepairReason} | ${topPending} |`);
  }
  mdLines.push("");
  mdLines.push("## Failure Forensics");
  mdLines.push("");
  for (const c of result.cases.filter((x) => x.status === "failed" || x.status === "discovered_partial")) {
    mdLines.push(`### C${c.caseId} - ${c.title}`);
    mdLines.push(`- finalReason: ${c.failureReason ?? "-"}`);
    mdLines.push(`- previousStatus: ${c.previousStatus ?? c.status}`);
    mdLines.push(`- finalStatus: ${c.finalStatus ?? c.status}`);
    mdLines.push(`- finalStatusReason: ${c.finalStatusReason ?? "-"}`);
    mdLines.push(`- pendingBefore: ${c.pendingBefore ?? "-"}`);
    mdLines.push(`- pendingAfter: ${c.pendingAfter ?? "-"}`);
    mdLines.push(`- promotionEligible: ${c.promotionEligible === undefined ? "-" : String(c.promotionEligible)}`);
    mdLines.push(`- rootCauseCategory: ${c.rootCauseCategory ?? "unknown"}`);
    mdLines.push(`- pendingAssertionCount: ${c.pendingAssertionCount ?? 0}`);
    mdLines.push(`- autoRepairCalled: ${c.autoRepairCalled ? "true" : "false"}`);
    mdLines.push(`- autoRepairReason: ${c.autoRepairReason ?? "-"}`);
    mdLines.push(`- localClosureConsumedCount: ${c.localClosureConsumedCount ?? 0}`);
    if (c.notConsumedReasons && c.notConsumedReasons.length > 0) {
      mdLines.push(`- notConsumedReasons: ${Array.from(new Set(c.notConsumedReasons)).join(", ")}`);
    }
    if (c.pendingAssertionForensics && c.pendingAssertionForensics.length > 0) {
      for (const f of c.pendingAssertionForensics.slice(0, 5)) {
        mdLines.push(`- pending: "${f.assertion}" reason=${f.notConsumedReason} expected=${f.expectedConsumption.join("|")}`);
      }
    }
    mdLines.push("");
  }

  const mdPath = path.join(batchDir, "batch-summary.md");
  await fs.writeFile(mdPath, mdLines.join("\n"), "utf-8");
}

function printSummary(result: BatchResult): void {
  console.log("");
  console.log("=== Batch Discovery Summary ===");
  console.log(`Batch ID: ${result.batchId}`);
  console.log("");
  console.log(`  Selected:    ${result.summary.selected}`);
  console.log(`  Requested:   ${result.summary.requested}`);
  console.log(`  Executed:    ${result.summary.executed}`);
  console.log(`  Skipped:     ${result.summary.skipped}`);
  console.log(`  Passed:      ${result.summary.passed}`);
  console.log(`  Failed:      ${result.summary.failed}`);
  console.log(`  Promoted:    ${result.summary.promoted}`);
  console.log(`  Already active (skipped): ${result.summary.alreadyActiveSkipped}`);
  console.log(`  Active rerun: ${result.summary.activeRerun}`);
  console.log(`  Promotion failed: ${result.summary.promotionFailed}`);
  console.log(`  Not promoted: ${result.summary.notPromoted}`);
  console.log(`  Total duration: ${result.summary.totalDurationMs}ms`);
  console.log(`[discovery:batch] Functional summary: promoted=${result.summary.promoted} discovered_partial=${result.cases.filter((c) => c.status === "discovered_partial").length} failed=${result.summary.failed}`);
  console.log("");
  console.log("Cases:");
  for (const c of result.cases) {
    const id = `C${c.caseId}`;
    const statusStr = c.selected ? `[${c.status}]` : `[skipped: ${c.skipReason ?? c.status}]`;
    console.log(`  ${statusStr} ${id} - ${c.title}${c.durationMs !== undefined ? ` (${c.durationMs}ms)` : ""}`);
    if (c.failureReason) {
      console.log(`    Reason: ${c.failureReason}`);
    }
    if (c.specPath) {
      console.log(`    Spec: ${c.specPath}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseBatchArgs(process.argv.slice(2));

  const projectId = config.integrations.testRail?.projectId;
  if (!projectId) {
    throw new Error("TESTRAIL_PROJECT_ID is not configured in .env.");
  }

  console.log(`[discovery:batch] Batch mode: ${args.mode}`);
  if (args.limit) console.log(`[discovery:batch] Limit: ${args.limit}`);
  console.log(`[discovery:batch] Overwrite enabled: ${args.overwrite}`);
  console.log(`[discovery:batch] Rerun active enabled: ${args.rerunActive}`);
  if (args.dryRun) console.log("[discovery:batch] DRY RUN - no discovery will be executed");
  if (args.autoRepair) {
    console.log(`[discovery:batch] Auto-repair enabled: true`);
    console.log(`[discovery:batch] Repair timeout: ${args.repairTimeoutMs}ms`);
    if (args.compactAgentPrompt) {
      console.log(`[discovery:batch] Compact agent prompt: true`);
      if (args.agentPromptBudgetSeconds) console.log(`[discovery:batch] Agent prompt budget: ${args.agentPromptBudgetSeconds}s`);
      if (args.agentMaxCandidates) console.log(`[discovery:batch] Agent max candidates: ${args.agentMaxCandidates}`);
      if (args.agentMaxProposedActions) console.log(`[discovery:batch] Agent max proposed actions: ${args.agentMaxProposedActions}`);
      if (args.agentMaxAttempts) console.log(`[discovery:batch] Agent max attempts: ${args.agentMaxAttempts}`);
    }
  }

  const testRailRuntimeConfig = requireTestRailConfig(config);
  const client = new TestRailClient(testRailRuntimeConfig);

  const resolvedApp = await resolveBatchAppProfile(args);

  console.log("[discovery:batch] Selecting cases...");
  const entries = await selectCases(client, args);

  const selected = entries.filter((e) => e.selected);
  if (args.rerunActive) {
    for (const entry of selected) {
      console.log(`[discovery:batch] Including active case C${entry.caseId} because --rerun-active is set`);
    }
  } else {
    for (const entry of entries.filter((e) => !e.selected && e.skipReason === "already_active")) {
      console.log(`[discovery:batch] Skipped C${entry.caseId} reason=already_active`);
    }
  }
  console.log(`[discovery:batch] Selected ${selected.length} cases, skipped ${entries.length - selected.length}.`);

  if (selected.length > 0 && !args.dryRun) {
    console.log(`[discovery:batch] Mode: ${args.mode}, Concurrency: ${args.concurrency}, Parallel: ${args.parallel}`);
  }

  if (args.dryRun) {
    console.log("");
    console.log("=== DRY RUN - Cases that would be executed ===");
    for (const e of entries) {
      const marker = e.selected ? " [x]" : " [ ]";
      console.log(`${marker} C${e.caseId} - ${e.title}${e.skipReason ? ` (skipped: ${e.skipReason})` : ""}`);
    }
    console.log("");
    console.log(`Total selected: ${selected.length}`);
    return;
  }

  const result = await executeBatch(args, entries, resolvedApp.appProfile);

  printSummary(result);

  const batchDir = path.resolve(`./.artifacts/discovery/batch/${result.batchId}`);
  console.log("");
  console.log(`Batch result: ${path.join(batchDir, "batch-result.json")}`);
  console.log(`Batch summary: ${path.join(batchDir, "batch-summary.md")}`);

  if (result.summary.failed > 0) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("discovery-batch.ts");
if (isMainModule) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[discovery:batch] ${message}`);
      process.exitCode = 1;
    });
}
