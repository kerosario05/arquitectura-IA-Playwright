import path from "node:path";
import { writeFile, readdir, readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import { createAIExplorer } from "../ai/ai-explorer";
import { config as envConfig, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { normalizeTestRailCases } from "../testrail/testrail-normalizer";
import { getLoginStrategy } from "../auth/login-strategy.factory";
import { runCaseDiscovery } from "./case-discovery";
import { evaluatePromotionGate } from "../automations/promotion-gate";
import { promoteExecutionPlan } from "../automations/promote-plan";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";
import type { PromotionPolicy } from "../types/automation-promotion.types";
import { executeExecutionPlan } from "../runner/execution-plan-executor";
import { buildDataContext } from "../data/data-context";
import { resolveAgentAutoRepairConfig, runAgentAutoRepairAttempt } from "../agent";
import { runSegmentedRouteRecovery } from "../agent/segment-route-recovery";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { FullConfig } from "../types/env.types";
import type { CaseDiscoveryResult } from "../types/discovery.types";

export type CaseDiscoveryWorkflowOptions = {
  caseId: number;
  headed: boolean;
  outputDir?: string;
  autoPromote: boolean;
  promotionDryRun: boolean;
  promotionStrict: boolean;
  requirePromotionApproval: boolean;
  pageObjectMode?: boolean;
  inlineDebugSpec?: boolean;
  allowPageObjectCandidates?: boolean;
  overwrite?: boolean;
  config?: FullConfig;
  testRailClient?: TestRailClient;
  autoRepair?: boolean;
  repairTimeoutMs?: number;
  showAgentLog?: boolean;
  continueOnAgentTimeout?: boolean;
  compactAgentPrompt?: boolean;
  agentPromptBudgetSeconds?: number;
  agentMaxCandidates?: number;
  agentMaxProposedActions?: number;
  agentMaxAttempts?: number;
  autoPom?: boolean;
  autoPomThreshold?: number;
  noAutoPomValidation?: boolean;
};

export type CaseDiscoveryWorkflowResult = {
  caseResult: CaseDiscoveryResult;
  promoted: boolean;
  promotionStatus: string;
  automationId?: string;
  appSlug?: string;
  specPath?: string;
  outputDir: string;
  evidenceDir: string;
  durationMs: number;
};

function getDefaultOutputDir(caseId: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`./.artifacts/discovery/case-${caseId}/${stamp}`);
}

async function loadLatestSnapshot(dir: string): Promise<{ snapshot?: PageSnapshot; snapshotPath?: string }> {
  try {
    const files = await readdir(dir);
    const candidates = files
      .filter((f) => f.endsWith("-snapshot.json"))
      .sort((a, b) => a.localeCompare(b));
    const last = candidates[candidates.length - 1];
    if (!last) return {};
    const snapshotPath = path.join(dir, last);
    return { snapshotPath, snapshot: JSON.parse(await readFile(snapshotPath, "utf-8")) as PageSnapshot };
  } catch {
    return {};
  }
}

export function printCaseDiscoverySummary(result: CaseDiscoveryResult, workflowResult?: CaseDiscoveryWorkflowResult): void {
  console.log("");
  console.log("=== Case Discovery Results ===");
  console.log(`Case: C${result.caseId} - ${result.caseTitle}`);
  console.log(`Status: ${result.status}`);
  console.log(`Discovered at: ${result.discoveredAt}`);
  if (workflowResult) {
    console.log(`Duration: ${workflowResult.durationMs}ms`);
    console.log(`Promoted: ${workflowResult.promoted ? "yes" : "no"}`);
    console.log(`Promotion status: ${workflowResult.promotionStatus}`);
  }
  console.log("");

  console.log("Steps:");
  for (const step of result.steps) {
    const icon = step.status === "found" ? "✓" : step.status === "not_found" ? "✗" : step.status === "click_no_transition" ? "⚠" : "-";
    console.log(`  ${icon} Step ${step.index}: ${step.action}`);
    if (step.targetText) {
      console.log(`    Target: ${step.targetText}`);
    }
    if (step.error) {
      console.log(`    Error: ${step.error}`);
    }
    if (step.attemptedLocators && step.attemptedLocators.length > 0) {
      console.log(`    Attempted locators: ${step.attemptedLocators.join(" | ")}`);
    }
    if (step.evidencePath) {
      console.log(`    Evidence: ${step.evidencePath}`);
    }
  }

  console.log("");
  console.log(`Discovered objects: ${result.discoveredObjects.length}`);
  if (result.discoveredObjects.length > 0) {
    const byType: Record<string, number> = {};
    for (const obj of result.discoveredObjects) {
      byType[obj.type] = (byType[obj.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(byType)) {
      console.log(`  ${type}: ${count}`);
    }
  }

  console.log("");
  console.log(`Pending objects: ${result.pendingObjectsPath ?? "N/A"}`);
  console.log(`Pending plans: ${result.pendingPlansPath ?? "N/A"}`);
  console.log(`Evidence dir: ${result.evidenceDir ?? "N/A"}`);

  if (result.candidatePlan) {
    console.log("");
    console.log(`Candidate plan steps: ${result.candidatePlan.steps.length}`);
    console.log(`Candidate plan status: ${result.candidatePlan.status}`);
  }

  if (result.failedAtStep) {
    console.log("");
    console.log(`Failed at step: ${result.failedAtStep}`);
    console.log(`Failed target: ${result.failedTarget ?? "unknown"}`);
    if (result.failedReason) {
      console.log(`Failed reason: ${result.failedReason}`);
    }
  }

  if (workflowResult) {
    console.log("");
    console.log("--- Promotion ---");
    console.log(`Status: ${workflowResult.promotionStatus}`);
    if (workflowResult.promoted) {
      console.log(`Automation: ${workflowResult.automationId}`);
      console.log(`Spec: ${workflowResult.specPath}`);
    }
    if (workflowResult.specPath) {
      console.log(`Spec path: ${workflowResult.specPath}`);
    }
  }

  if (result.status === "discovered_passed" && result.candidatePlan?.status === "validated" && workflowResult && !workflowResult.promoted) {
    console.log("");
    console.log(`[discovery:case] To promote manually:`);
    console.log(`[discovery:case] npm.cmd run plans:promote -- --from ${workflowResult.outputDir}`);
  }

  if (workflowResult && !workflowResult.promoted && workflowResult.promotionStatus === "promotion_failed") {
    console.log("[discovery:case] Promotion gate blocked.");
  }
}

export async function runCaseDiscoveryWorkflow(
  options: CaseDiscoveryWorkflowOptions
): Promise<CaseDiscoveryWorkflowResult> {
  const startTime = Date.now();
  const activeConfig = options.config ?? envConfig;
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : getDefaultOutputDir(options.caseId);
  const evidenceDir = path.join(outputDir, "evidence");
  const pendingObjectsPath = path.join(outputDir, "discovered-objects.pending.json");
  const pendingPlansPath = path.join(outputDir, "discovered-plans.pending.json");

  let client: TestRailClient;
  if (options.testRailClient) {
    client = options.testRailClient;
  } else {
    const testRailRuntimeConfig = requireTestRailConfig(activeConfig);
    client = new TestRailClient(testRailRuntimeConfig);
  }

  const rawCase = await client.getCase(options.caseId);
  const scenarios = normalizeTestRailCases([rawCase]);

  if (scenarios.length === 0) {
    throw new Error(`No scenario could be generated for case C${options.caseId}.`);
  }

  const scenario = scenarios[0];

  const browserType = { chromium, firefox, webkit }[activeConfig.execution.browser];
  const headless = !options.headed;

  let browser;
  let caseResult: CaseDiscoveryResult;
  let promoted = false;
  let automationId: string | undefined;
  let appSlug: string | undefined;
  let specPath: string | undefined;
  let promotionStatus = "not_promoted";
  try {
    browser = await browserType.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(activeConfig.execution.defaultTimeoutMs);

    const loginStrategy = getLoginStrategy(activeConfig.app.loginMode);

    caseResult = await runCaseDiscovery({
      page,
      scenario,
      evidenceDir,
      pendingObjectsPath,
      pendingPlansPath,
      appBaseUrl: activeConfig.app.baseUrl,
      testData: activeConfig.app.testData,
      loginAction: async () => {
        await loginStrategy.execute(page, activeConfig);
      },
      aiAssistedDiscovery: {
        explorer: createAIExplorer({
          provider: activeConfig.integrations.ai?.agentProvider ?? "custom"
        }),
        config: {
          enabled: activeConfig.integrations.ai?.discoveryEnabled ?? false,
          confidenceThreshold: activeConfig.integrations.ai?.discoveryConfidenceThreshold ?? 0.85,
          requireApprovalThreshold: activeConfig.integrations.ai?.discoveryRequireApprovalThreshold ?? 0.7,
          maxAttempts: activeConfig.integrations.ai?.discoveryMaxAttempts ?? 3
        }
      }
    });

    const agentCfg = resolveAgentAutoRepairConfig(activeConfig);

    if (options.autoRepair === true) {
      agentCfg.enabled = true;
    }
    if (options.repairTimeoutMs !== undefined) {
      agentCfg.timeoutMs = options.repairTimeoutMs;
    }
    if (options.agentMaxAttempts !== undefined) {
      agentCfg.maxAttempts = options.agentMaxAttempts;
    }
    if (options.compactAgentPrompt) {
      agentCfg.compactPrompt = true;
      agentCfg.promptMode = "compact-route-recovery";
    }
    console.log(`[discovery:workflow] Auto-repair enabled: ${agentCfg.enabled}`);
    console.log(`[discovery:workflow] Repair timeout: ${agentCfg.timeoutMs}ms`);
    console.log(`[discovery:workflow] Max attempts: ${agentCfg.maxAttempts}`);

    const RECOVERABLE_REASONS = new Set([
      "target_not_found",
      "ambiguous_target",
      "locator_resolution_failed",
      "needs_discovery",
      "needs_associated_target_resolution",
      "needs_assertion_resolution",
      "fill_target_not_found",
      "fill_target_not_editable",
      "semantic_target_not_found",
      "click_no_transition",
      "assertion_not_found"
    ]);

    const shouldAttemptRepair =
      agentCfg.enabled
      && !options.promotionDryRun
      && caseResult.status !== "discovered_passed"
      && caseResult.status !== "repaired_passed"
      && Boolean(caseResult.failedReason && RECOVERABLE_REASONS.has(caseResult.failedReason))
      && Boolean(caseResult.candidatePlan)
      && Boolean((await loadLatestSnapshot(evidenceDir)).snapshot);

    if (agentCfg.enabled && caseResult.status === "discovered_passed") {
      // AI discovery skipped, deterministic confidence sufficient
    }

    if (shouldAttemptRepair) {
      const { snapshot, snapshotPath } = await loadLatestSnapshot(evidenceDir);
      const dataContext = buildDataContext(activeConfig);

      let repaired = false;
      for (let attempt = 1; attempt <= agentCfg.maxAttempts; attempt += 1) {
        console.log(`[discovery:workflow] Auto-repair attempt ${attempt}/${agentCfg.maxAttempts}`);
        const attemptResult = await runAgentAutoRepairAttempt({
          fullConfig: activeConfig,
          outputDir,
          attemptNumber: attempt,
          kind: "plan_repair",
          repairTimeoutMs: agentCfg.timeoutMs,
          failureSummary: `${caseResult.failedReason ?? "unknown"} at step ${caseResult.failedAtStep ?? "?"} target "${caseResult.failedTarget ?? ""}"`,
          scenario,
          currentPlan: caseResult.candidatePlan,
          snapshot,
          evidenceDir,
          snapshotPath,
          candidatePlanPath: pendingPlansPath,
          pendingObjectsPath,
          pendingPlansPath,
          failedReason: caseResult.failedReason,
          failedTarget: caseResult.failedTarget,
          failedAtStep: caseResult.failedAtStep,
          showAgentLog: options.showAgentLog ?? false,
          compactPrompt: options.compactAgentPrompt,
          promptBudgetSeconds: options.agentPromptBudgetSeconds,
          maxCandidates: options.agentMaxCandidates,
          maxProposedActions: options.agentMaxProposedActions,
          maxAttemptsOverride: options.agentMaxAttempts
        });

        if (!attemptResult.success) {
          console.log(`[discovery:workflow] Attempt ${attempt} failed: ${attemptResult.reason}`);
          if (attempt < agentCfg.maxAttempts) {
            console.log(`[discovery:workflow] Starting attempt ${attempt + 1}/${agentCfg.maxAttempts} because retry policy allows it.`);
          }

          if (attemptResult.status === "timeout" && options.continueOnAgentTimeout) {
            caseResult = { ...caseResult, status: "needs_agent", failedReason: "auto_repair_timeout" };
            break;
          }
          if (attemptResult.status === "no_proposal") {
            caseResult = { ...caseResult, status: "needs_agent" };
            break;
          }

          if (attempt === agentCfg.maxAttempts) {
            caseResult = { ...caseResult, status: "auto_repair_exhausted" };
          }
          continue;
        }

        // Run segmented route recovery: execute plan, wait for transition,
        // re-interpret failed target against new snapshot, iterate up to maxSegments.
        const segmentResult = await runSegmentedRouteRecovery({
          page,
          outputDir,
          evidenceDir,
          fullConfig: activeConfig,
          scenario,
          currentPlan: caseResult.candidatePlan!,
          pendingSteps: [],
          failedReason: caseResult.failedReason ?? "unknown",
          failedTarget: caseResult.failedTarget ?? "",
          failedAtStep: caseResult.failedAtStep ?? 1,
          snapshot: snapshot!,
          snapshotPath: snapshotPath ?? "",
          maxSegments: 3,
          showAgentLog: options.showAgentLog ?? false,
          compactPrompt: options.compactAgentPrompt ?? false,
          promptBudgetSeconds: options.agentPromptBudgetSeconds,
          maxCandidates: options.agentMaxCandidates,
          maxProposedActions: options.agentMaxProposedActions,
          agentCfg
        });

        if (segmentResult.success) {
          // Mark the failed step as recovered with segment metadata
          const failedStepIdx = caseResult.failedAtStep;
          const lastSegment = segmentResult.segments[segmentResult.segments.length - 1];
          const updatedSteps = caseResult.steps.map((step) => {
            if (step.index === failedStepIdx && step.status === "not_found") {
              return {
                ...step,
                originalStatus: step.status,
                status: "found" as const,
                recoveryStatus: "recovered" as const,
                recoveredBy: "segmented_route_recovery" as const,
                recoveryMetadata: lastSegment ? {
                  selectedCandidateId: lastSegment.candidateId ?? "",
                  selectedCandidateText: lastSegment.candidateText,
                  semanticRelation: undefined,
                  score: undefined,
                  segmentIndex: lastSegment.segmentIndex,
                  transitionDetected: lastSegment.executionStatus === "passed",
                  executedAction: lastSegment.action ?? "click",
                  rationale: `Recovered via segmented route recovery: ${lastSegment.candidateText ?? lastSegment.candidateId}`
                } : undefined
              };
            }
            return step;
          });

          // Add the executed recovery step to the candidate plan
          const recoveredPlan = segmentResult.candidatePlan ?? attemptResult.repairedPlan;
          const finalPlan = lastSegment && lastSegment.candidateId ? {
            ...recoveredPlan,
            notes: [
              ...(recoveredPlan.notes ?? []),
              `Route recovery segment ${lastSegment.segmentIndex}: clicked "${lastSegment.candidateText ?? lastSegment.candidateId}" via ${lastSegment.recoveryDecision}`
            ]
          } : recoveredPlan;

          caseResult = {
            ...caseResult,
            status: "repaired_passed" as const,
            candidatePlan: finalPlan,
            steps: updatedSteps,
            failedReason: undefined,
            failedTarget: undefined,
            failedAtStep: undefined
          };
          repaired = true;
          break;
        }

        if (attempt === agentCfg.maxAttempts) {
          caseResult = { ...caseResult, status: "auto_repair_exhausted" };
          // Preserve original failure info when segments exhausted
          if (segmentResult.segments.length > 0) {
            caseResult.failedReason = segmentResult.failedReason;
          }
        }
      }
    }

    const promotionPolicy: PromotionPolicy = {
      ...DEFAULT_PROMOTION_POLICY,
      specMode: options.inlineDebugSpec ? "inline-debug" : (options.pageObjectMode !== false ? "page-object" : "inline-debug"),
      allowCandidateGeneration: options.allowPageObjectCandidates !== false,
      autoPom: options.autoPom === true,
      autoApproveConfidenceThreshold: options.autoPomThreshold ?? DEFAULT_PROMOTION_POLICY.autoApproveConfidenceThreshold,
      autoRunPomValidation: options.noAutoPomValidation !== true
    };

    console.log(`[discovery:workflow] Overwrite enabled: ${options.overwrite === true}`);

    const promotionResultPath = path.join(outputDir, "promotion-result.json");
    const gate = evaluatePromotionGate({
      discoveryResult: caseResult,
      candidatePlan: caseResult.candidatePlan,
      strict: options.promotionStrict,
      requireApproval: options.requirePromotionApproval,
      promotionPolicy
    });

    const promotionReport: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      autoPromoteRequested: options.autoPromote,
      gateAllowed: gate.allowed,
      gateStatus: gate.status,
      reasons: gate.reasons,
      warnings: gate.warnings,
      promoted: false
    };

    if (!options.autoPromote) {
      promotionStatus = "not_promoted";
    } else if (options.promotionDryRun) {
      if (gate.allowed) {
        promotionStatus = "dry_run_passed";
      } else {
        promotionStatus = "dry_run_blocked";
      }
    } else if (!gate.allowed) {
      promotionStatus = gate.status === "not_applicable" ? "not_applicable" : "promotion_failed";
    } else if (caseResult.candidatePlan) {
      const promotedEntry = await promoteExecutionPlan(
        {
          plan: caseResult.candidatePlan,
          sourcePlanPath: pendingPlansPath,
          source: "discovery",
          overwrite: options.overwrite === true,
          fullConfig: activeConfig,
          promotionPolicy,
          inlineDebugMode: options.inlineDebugSpec ?? false
        },
        false,
        {
          discoveryDir: outputDir
        }
      );
      promoted = true;
      if (promotedEntry.pomStatus === "needs_page_object" || promotedEntry.pomStatus === "needs_page_method" || promotedEntry.pomStatus === "blocked_missing_pom") {
        promotionStatus = promotedEntry.pomStatus;
      } else if (promotedEntry.pomStatus === "inline_debug_only") {
        promotionStatus = "inline_debug_only";
      } else {
        promotionStatus = "promoted";
      }
      automationId = promotedEntry.id;
      appSlug = promotedEntry.appSlug;
      specPath = promotedEntry.specPath;
      promotionReport.promoted = true;
      promotionReport.automationId = promotedEntry.id;
      promotionReport.appSlug = promotedEntry.appSlug;
      promotionReport.specPath = promotedEntry.specPath;
      promotionReport.planPath = promotedEntry.planPath;
      promotionReport.caseFolder = promotedEntry.id;
      promotionReport.pomStatus = promotedEntry.pomStatus;
      promotionReport.inlineDebugMode = promotedEntry.inlineDebugMode;
    } else {
      promotionStatus = "promotion_failed";
    }

    await writeFile(promotionResultPath, JSON.stringify(promotionReport, null, 2), "utf-8");
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return {
    caseResult,
    promoted,
    promotionStatus,
    automationId,
    appSlug,
    specPath,
    outputDir,
    evidenceDir,
    durationMs: Date.now() - startTime
  };
}
