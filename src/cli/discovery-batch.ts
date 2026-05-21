import path from "node:path";
import fs from "node:fs/promises";
import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { runCaseDiscoveryWorkflow } from "../discovery/case-discovery-workflow";
import { getCaseAutomationStatus } from "../cases/case-automation-status";
import type { CaseDiscoveryWorkflowOptions, CaseDiscoveryWorkflowResult } from "../discovery/case-discovery-workflow";

export type BatchCaseMode = "all" | "not-automated" | "by-ids" | "by-range";

export type BatchCliArgs = {
  mode: BatchCaseMode;
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
  stopOnFail: boolean;
  concurrency: number;
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
  skipReason?: string;
  status: BatchCaseState;
  promoted: boolean;
  promotionStatus?: string;
  outputDir?: string;
  evidenceDir?: string;
  specPath?: string;
  failureReason?: string;
  durationMs?: number;
};

export type BatchResult = {
  batchId: string;
  timestamp: string;
  args: {
    mode: BatchCaseMode;
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
    stopOnFail: boolean;
    concurrency: number;
    autoRepair: boolean;
    repairTimeoutMs: number;
    showAgentLog: boolean;
    continueOnAgentTimeout: boolean;
  };
  cases: BatchCaseResultEntry[];
  summary: {
    selected: number;
    executed: number;
    skipped: number;
    passed: number;
    failed: number;
    promoted: number;
    alreadyActiveSkipped: number;
    promotionFailed: number;
    notPromoted: number;
    totalDurationMs: number;
  };
};

export function parseBatchArgs(argv: string[]): BatchCliArgs {
  const args: BatchCliArgs = {
    mode: "all",
    caseIds: [],
    headed: false,
    autoPromote: false,
    promotionDryRun: false,
    promotionStrict: false,
    requirePromotionApproval: false,
    dryRun: false,
    includeActive: false,
    stopOnFail: false,
    concurrency: 1,
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
    if (token === "--stop-on-fail") {
      args.stopOnFail = true;
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

  if (args.headed && args.concurrency > 1) {
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
  entries: BatchCaseResultEntry[]
): Promise<BatchResult> {
  const batchId = new Date().toISOString().replace(/[:.]/g, "-");
  const batchDir = path.resolve(`./.artifacts/discovery/batch/${batchId}`);
  await fs.mkdir(path.join(batchDir, "cases"), { recursive: true });

  const selected = entries.filter((e) => e.selected);

  if (args.dryRun || selected.length === 0) {
    const startTime = Date.now();
    const result: BatchResult = {
      batchId,
      timestamp: new Date().toISOString(),
      args: serializeArgs(args),
      cases: entries,
      summary: {
        selected: selected.length,
        executed: 0,
        skipped: entries.length - selected.length,
        passed: 0,
        failed: 0,
        promoted: 0,
        alreadyActiveSkipped: entries.filter((e) => e.status === "skipped_active").length,
        promotionFailed: 0,
        notPromoted: 0,
        totalDurationMs: Date.now() - startTime
      }
    };

    await writeBatchArtifacts(batchDir, result);
    return result;
  }

  const concurrency = Math.max(1, args.concurrency);
  const results: BatchCaseResultEntry[] = [];
  const startTime = Date.now();
  let shouldStop = false;

  const testRailRuntimeConfig = requireTestRailConfig(config);
  const sharedClient = new TestRailClient(testRailRuntimeConfig);

  async function runSingleCase(entry: BatchCaseResultEntry): Promise<BatchCaseResultEntry> {
    if (shouldStop) return { ...entry, status: "skipped_filter", skipReason: "stopped_on_fail" };

    const caseStartTime = Date.now();
    console.log(`[discovery:batch] Running case C${entry.caseId} - ${entry.title}`);

    try {
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
        agentMaxAttempts: args.agentMaxAttempts
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
        durationMs
      };

      console.log(`[discovery:batch] Case C${entry.caseId} finished: ${state} (${durationMs}ms)`);
      return resultEntry;
    } catch (error) {
      const durationMs = Date.now() - caseStartTime;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[discovery:batch] Case C${entry.caseId} failed with error: ${message}`);

      return {
        caseId: entry.caseId,
        title: entry.title,
        selected: true,
        status: "failed",
        promoted: false,
        failureReason: message,
        durationMs
      };
    }
  }

  if (concurrency === 1) {
    for (const entry of selected) {
      if (shouldStop) break;

      const resultEntry = await runSingleCase(entry);

      if (args.stopOnFail && (resultEntry.status === "failed" || resultEntry.status === "exploration_failed" || resultEntry.status === "promotion_failed")) {
        shouldStop = true;
      }

      results.push(resultEntry);
    }
  } else {
    const queue = [...selected];
    let runningCount = 0;

    while (queue.length > 0 || runningCount > 0) {
      const batch: Promise<BatchCaseResultEntry>[] = [];

      while (batch.length < concurrency && queue.length > 0 && !shouldStop) {
        const entry = queue.shift()!;
        runningCount += 1;
        batch.push(runSingleCase(entry).then((r) => {
          if (args.stopOnFail && (r.status === "failed" || r.status === "exploration_failed" || r.status === "promotion_failed")) {
            shouldStop = true;
          }
          return r;
        }));
      }

      if (batch.length > 0) {
        const settled = await Promise.allSettled(batch);
        for (const s of settled) {
          if (s.status === "fulfilled") {
            results.push(s.value);
          }
          runningCount -= 1;
        }
      } else if (runningCount > 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  const nonSelected = entries.filter((e) => !e.selected);
  const allResults = [...nonSelected, ...results];
  allResults.sort((a, b) => a.caseId - b.caseId);

  const passed = results.filter((r) => r.status === "discovered_passed" || r.status === "repaired_passed").length;
  const failed = results.filter((r) => r.status === "failed" || r.status === "exploration_failed").length;
  const promoted = results.filter((r) => r.promoted).length;
  const promotionFailed = results.filter((r) => r.status === "promotion_failed").length;
  const notPromoted = results.filter((r) => r.status === "not_promoted").length;
  const alreadyActiveSkipped = allResults.filter((r) => r.status === "skipped_active").length;

  const batchResult: BatchResult = {
    batchId,
    timestamp: new Date().toISOString(),
    args: serializeArgs(args),
    cases: allResults,
    summary: {
      selected: selected.length,
      executed: results.length,
      skipped: allResults.length - results.length,
      passed,
      failed,
      promoted,
      alreadyActiveSkipped,
      promotionFailed,
      notPromoted,
      totalDurationMs: Date.now() - startTime
    }
  };

  await writeBatchArtifacts(batchDir, batchResult);

  return batchResult;
}

function serializeArgs(args: BatchCliArgs): BatchResult["args"] {
  return {
    mode: args.mode,
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
    stopOnFail: args.stopOnFail,
    concurrency: args.concurrency,
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
  mdLines.push(`- Stop on fail: ${result.args.stopOnFail}`);
  mdLines.push(`- Concurrency: ${result.args.concurrency}`);
  if (result.args.limit !== undefined) {
    mdLines.push(`- Limit: ${result.args.limit}`);
  }
  mdLines.push("");
  mdLines.push("## Summary");
  mdLines.push("");
  mdLines.push(`| Metric | Value |`);
  mdLines.push(`|--------|-------|`);
  mdLines.push(`| Selected | ${result.summary.selected} |`);
  mdLines.push(`| Executed | ${result.summary.executed} |`);
  mdLines.push(`| Skipped | ${result.summary.skipped} |`);
  mdLines.push(`| Passed | ${result.summary.passed} |`);
  mdLines.push(`| Failed | ${result.summary.failed} |`);
  mdLines.push(`| Promoted | ${result.summary.promoted} |`);
  mdLines.push(`| Already active (skipped) | ${result.summary.alreadyActiveSkipped} |`);
  mdLines.push(`| Promotion failed | ${result.summary.promotionFailed} |`);
  mdLines.push(`| Not promoted | ${result.summary.notPromoted} |`);
  mdLines.push(`| Total duration | ${result.summary.totalDurationMs}ms |`);
  mdLines.push("");
  mdLines.push("## Cases");
  mdLines.push("");
  mdLines.push("| Case ID | Title | Status | Promoted | Duration | Failure Reason |");
  mdLines.push("|---------|-------|--------|----------|----------|----------------|");
  for (const c of result.cases) {
    const id = `C${c.caseId}`;
    const title = c.title.replace(/\|/g, "\\|");
    const duration = c.durationMs !== undefined ? `${c.durationMs}ms` : "-";
    const failure = c.failureReason ? c.failureReason.replace(/\|/g, "\\|") : "-";
    mdLines.push(`| ${id} | ${title} | ${c.status} | ${c.promoted ? "yes" : "no"} | ${duration} | ${failure} |`);
  }
  mdLines.push("");

  const mdPath = path.join(batchDir, "batch-summary.md");
  await fs.writeFile(mdPath, mdLines.join("\n"), "utf-8");
}

function printSummary(result: BatchResult): void {
  console.log("");
  console.log("=== Batch Discovery Summary ===");
  console.log(`Batch ID: ${result.batchId}`);
  console.log("");
  console.log(`  Selected:    ${result.summary.selected}`);
  console.log(`  Executed:    ${result.summary.executed}`);
  console.log(`  Skipped:     ${result.summary.skipped}`);
  console.log(`  Passed:      ${result.summary.passed}`);
  console.log(`  Failed:      ${result.summary.failed}`);
  console.log(`  Promoted:    ${result.summary.promoted}`);
  console.log(`  Already active (skipped): ${result.summary.alreadyActiveSkipped}`);
  console.log(`  Promotion failed: ${result.summary.promotionFailed}`);
  console.log(`  Not promoted: ${result.summary.notPromoted}`);
  console.log(`  Total duration: ${result.summary.totalDurationMs}ms`);
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

  console.log("[discovery:batch] Selecting cases...");
  const entries = await selectCases(client, args);

  const selected = entries.filter((e) => e.selected);
  console.log(`[discovery:batch] Selected ${selected.length} cases, skipped ${entries.length - selected.length}.`);

  if (selected.length > 0 && !args.dryRun) {
    console.log(`[discovery:batch] Mode: ${args.mode}, Concurrency: ${args.concurrency}`);
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

  const result = await executeBatch(args, entries);

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
