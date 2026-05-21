import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { scanCurrentPage } from "../explorer/page-scanner";
import { waitForPageReady } from "../browser/page-readiness";
import { buildRouteRecoveryPack, computeRouteRecoveryPackStats } from "./route-recovery-pack";
import { runCodexAutoRepair } from "./codex-auto-repair";
import { buildDataContext } from "../data/data-context";
import { buildAgentHandoffRequest } from "./handoff-builder";
import { writeAgentHandoffPackage } from "./handoff-writer";
import type { AgentAutoRepairConfig } from "./agent-auto-repair";
import { executeExecutionPlan } from "../runner/execution-plan-executor";
import type { FullConfig } from "../types/env.types";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { RouteRecoveryDecision } from "../types/route-recovery-decision.types";
import type { CodexAutoRepairInput } from "../types/codex-auto-repair.types";
import type { AgentHandoffResponse } from "../types/agent-handoff.types";

export type RouteRecoverySegmentRecord = {
  segmentIndex: number;
  recoveryDecision: string;
  candidateId?: string;
  candidateText?: string;
  semanticRelation?: string;
  score?: number;
  action?: string;
  snapshotPath: string;
  executionStatus: "pending" | "passed" | "failed";
  error?: string;
};

export type SegmentedRouteRecoveryInput = {
  page: Page;
  outputDir: string;
  evidenceDir: string;
  fullConfig: FullConfig;
  scenario: { title?: string; steps?: Array<{ action: string; target?: string }> };
  currentPlan: ExecutionPlan;
  pendingSteps: Array<{ index: number; action: string; target?: string }>;
  failedReason: string;
  failedTarget: string;
  failedAtStep: number;
  snapshot: PageSnapshot;
  snapshotPath: string;
  maxSegments: number;
  showAgentLog: boolean;
  compactPrompt: boolean;
  promptBudgetSeconds?: number;
  maxCandidates?: number;
  maxProposedActions?: number;
  agentCfg: AgentAutoRepairConfig;
};

export type SegmentedRouteRecoveryResult = {
  success: boolean;
  status: "repaired_passed" | "needs_agent" | "auto_repair_exhausted";
  segments: RouteRecoverySegmentRecord[];
  candidatePlan?: ExecutionPlan;
  failedReason?: string;
  failedTarget?: string;
  failedAtStep?: number;
  finalSnapshot?: PageSnapshot;
  finalSnapshotPath?: string;
};

async function captureSnapshot(
  page: Page,
  evidenceDir: string,
  label: string
): Promise<{ snapshot: PageSnapshot; snapshotPath: string }> {
  await waitForPageReady(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
  const snapshot = await scanCurrentPage(page);
  const snapshotPath = path.join(evidenceDir, `${label}-snapshot.json`);
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  return { snapshot, snapshotPath };
}

function buildSegmentRecord(input: {
  segmentIndex: number;
  decision: RouteRecoveryDecision;
  snapshotPath: string;
  executionStatus: RouteRecoverySegmentRecord["executionStatus"];
  candidateText?: string;
  semanticRelation?: string;
  score?: number;
  error?: string;
}): RouteRecoverySegmentRecord {
  return {
    segmentIndex: input.segmentIndex,
    recoveryDecision: input.decision.recoveryDecision,
    candidateId: input.decision.recoveryDecision === "repaired_plan" ? input.decision.selectedCandidateId : undefined,
    candidateText: input.candidateText,
    semanticRelation: input.semanticRelation,
    score: input.score,
    action: input.decision.recoveryDecision === "repaired_plan" ? input.decision.action : undefined,
    snapshotPath: input.snapshotPath,
    executionStatus: input.executionStatus,
    error: input.error
  };
}

export async function runSegmentedRouteRecovery(
  input: SegmentedRouteRecoveryInput
): Promise<SegmentedRouteRecoveryResult> {
  const segments: RouteRecoverySegmentRecord[] = [];
  const failedRoutePaths: string[] = [];
  let currentSnapshot = input.snapshot;
  let currentSnapshotPath = input.snapshotPath;
  let currentPlan = input.currentPlan;

  for (let segmentIndex = 0; segmentIndex < input.maxSegments; segmentIndex++) {
    if (segmentIndex > 0) {
      const segEvidenceDir = path.join(input.evidenceDir, `segment-${segmentIndex}`);
      const capture = await captureSnapshot(input.page, segEvidenceDir, `segment-${segmentIndex}-before`);
      currentSnapshot = capture.snapshot;
      currentSnapshotPath = capture.snapshotPath;
    }

    // --- Build route recovery pack for this segment ---
    const handoffDir = path.join(input.outputDir, `segment-${segmentIndex}`);
    await mkdir(handoffDir, { recursive: true });

    const recoveryPack = buildRouteRecoveryPack({
      failedReason: input.failedReason,
      failedTarget: input.failedTarget,
      failedAtStep: input.failedAtStep,
      currentPlan,
      snapshot: currentSnapshot,
      scenario: input.scenario,
      budget: input.agentCfg.planningBudget,
      failedRoutePaths
    });

    const routeRecoveryPackPath = path.join(handoffDir, "route-recovery-pack.json");
    await writeFile(routeRecoveryPackPath, JSON.stringify(recoveryPack, null, 2), "utf-8");

    const stats = computeRouteRecoveryPackStats(recoveryPack);
    if (input.showAgentLog) {
      console.log(`[segment-${segmentIndex}] Recovery pack stats: visibleCandidates=${stats.visibleCandidates}, pendingSteps=${stats.pendingSteps}`);
      for (const cand of recoveryPack.topVisibleCandidates.slice(0, 10)) {
        console.log(`  ${cand.id} "${cand.text ?? cand.type}" role=${cand.role ?? "unknown"} actionability=${cand.actionability ?? "unknown"} score=${cand.score} relation=${cand.semanticRelation ?? "none"}`);
      }
    }

    // --- Check if the pending target is now directly resolvable ---
    // Priority: exact_match > near_match > parent_category; require score >= 0.50 and non-empty text
    const directHit = recoveryPack.topVisibleCandidates
      .filter((c) => c.text && c.text.length > 1 && c.score >= 0.50 && c.actionability === "clickable" && !failedRoutePaths.includes(c.id))
      .sort((a, b) => {
        const rankA = a.semanticRelation === "exact_match" ? 0 : a.semanticRelation === "near_match" ? 1 : a.semanticRelation === "parent_category" ? 2 : 3;
        const rankB = b.semanticRelation === "exact_match" ? 0 : b.semanticRelation === "near_match" ? 1 : b.semanticRelation === "parent_category" ? 2 : 3;
        if (rankA !== rankB) return rankA - rankB;
        return b.score - a.score;
      })[0];

    if (directHit) {
      if (input.showAgentLog) {
        console.log(`[segment-${segmentIndex}] Direct hit: "${directHit.text ?? directHit.type}" (${directHit.id}) resolved via ${directHit.semanticRelation}`);
      }

      const directPlanStep: ExecutionPlan["steps"][0] = {
        index: 1,
        action: "click",
        target: directHit.role && directHit.text
          ? { strategy: "role" as const, role: directHit.role, name: directHit.text }
          : { strategy: "text" as const, value: directHit.text ?? directHit.id }
      };

      const directPlan: ExecutionPlan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", title: "Route recovery" },
        requiredData: [],
        steps: [directPlanStep],
        createdAt: new Date().toISOString()
      };

      const segEvidenceDir = path.join(input.evidenceDir, `segment-${segmentIndex}`);
      const retry = await executeExecutionPlan({
        page: input.page,
        plan: directPlan,
        dataContext: buildDataContext(input.fullConfig),
        evidenceDir: segEvidenceDir,
        continueOnFailure: false,
        runtimeConfig: input.fullConfig,
        appBaseUrl: input.fullConfig.app.baseUrl
      });

      const executionStatus = retry.status === "passed" ? "passed" as const : "failed" as const;
      const segmentSnapshot = await captureSnapshot(input.page, segEvidenceDir, `segment-${segmentIndex}-after`);
      segments.push(buildSegmentRecord({
        segmentIndex,
        decision: {
          recoveryDecision: "repaired_plan",
          selectedCandidateId: directHit.id,
          action: "click",
          confidence: directHit.score,
          sensitive: false,
          rationale: `Direct resolution: ${directHit.semanticRelation} match for target "${input.failedTarget}"`
        },
        snapshotPath: segmentSnapshot.snapshotPath,
        executionStatus,
        candidateText: directHit.text,
        semanticRelation: directHit.semanticRelation,
        score: directHit.score
      }));

      if (executionStatus === "passed") {
        return {
          success: true,
          status: "repaired_passed",
          segments,
          candidatePlan: directPlan,
          finalSnapshot: segmentSnapshot.snapshot,
          finalSnapshotPath: segmentSnapshot.snapshotPath
        };
      }

      failedRoutePaths.push(directHit.id);
      continue;
    }

    // --- Run auto-repair via Codex (or deterministic fallback) ---
    const dataContext = buildDataContext(input.fullConfig);
    const request = buildAgentHandoffRequest({
      kind: "plan_repair",
      goal: `Route recovery segment ${segmentIndex}: ${input.failedReason} at "${input.failedTarget}"`,
      contextPackPath: undefined,
      scenario: input.scenario as never,
      currentPlan,
      snapshot: currentSnapshot,
      dataContext,
      selectedSkill: undefined
    });

    const { requestPath, instructionsPath, schemaPath, responsePath } = await writeAgentHandoffPackage({
      request,
      outputDir: handoffDir
    });

    const stdoutLogPath = path.join(handoffDir, "codex.stdout.log");
    const stderrLogPath = path.join(handoffDir, "codex.stderr.log");

    const cfg = {
      ...input.agentCfg,
      promptMode: (input.compactPrompt ? "compact-route-recovery" : input.agentCfg.promptMode) as "compact" | "verbose" | "compact-route-recovery",
      compactPrompt: input.compactPrompt || input.agentCfg.compactPrompt
    };
    const repair = await runCodexAutoRepair({
      handoffDir,
      requestPath,
      instructionsPath,
      responsePath,
      schemaPath,
      contextPackPath: undefined,
      projectRoot: process.cwd(),
      timeoutMs: cfg.timeoutMs,
      codexCommand: cfg.command,
      codexExtraArgs: cfg.extraArgs,
      promptMode: cfg.promptMode,
      showAgentLog: input.showAgentLog ?? false,
      stdoutLogPath,
      stderrLogPath,
      attempt: segmentIndex + 1,
      compactPrompt: cfg.compactPrompt,
      promptBudgetSeconds: cfg.promptBudgetSeconds,
      maxCandidates: cfg.maxCandidates,
      maxProposedActions: cfg.maxProposedActions,
      maxAttemptsOverride: cfg.maxAttempts,
      routeRecoveryPackPath,
      planningBudget: cfg.planningBudget
    } as CodexAutoRepairInput);

    await writeFile(
      path.join(handoffDir, "auto-repair-result.json"),
      JSON.stringify({ ...repair.diagnostics, timestamp: new Date().toISOString(), segmentIndex }, null, 2),
      "utf-8"
    );

    if (!repair.success || !repair.diagnostics) {
      const reason = repair.error ?? "Segment auto-repair failed.";
      const segSnapshot = await captureSnapshot(input.page, handoffDir, `segment-${segmentIndex}-after`);
      segments.push(buildSegmentRecord({
        segmentIndex,
        decision: { recoveryDecision: "no_safe_action", rationale: reason },
        snapshotPath: segSnapshot.snapshotPath,
        executionStatus: "failed",
        error: reason
      }));
      return {
        success: false,
        status: "needs_agent",
        segments,
        failedReason: reason,
        failedTarget: input.failedTarget,
        failedAtStep: input.failedAtStep,
        finalSnapshot: segSnapshot.snapshot,
        finalSnapshotPath: segSnapshot.snapshotPath
      };
    }

    const recoveryDecision = repair.diagnostics?.recoveryDecision;
    if (recoveryDecision === "no_safe_action" || recoveryDecision === "needs_more_context") {
      const segSnapshot = await captureSnapshot(input.page, handoffDir, `segment-${segmentIndex}-after`);
      const nonPlanDecision: RouteRecoveryDecision = recoveryDecision === "needs_more_context"
        ? { recoveryDecision: "needs_more_context", unresolvedQuestions: ["Segment recovery: insufficient context after execution."], rationale: repair.error ?? `AI: ${recoveryDecision}` }
        : { recoveryDecision: "no_safe_action", rationale: repair.error ?? `AI: ${recoveryDecision}` };
      segments.push(buildSegmentRecord({
        segmentIndex,
        decision: nonPlanDecision,
        snapshotPath: segSnapshot.snapshotPath,
        executionStatus: "failed",
        error: recoveryDecision
      }));
      return {
        success: false,
        status: "needs_agent",
        segments,
        failedReason: recoveryDecision,
        failedTarget: input.failedTarget,
        failedAtStep: input.failedAtStep,
        finalSnapshot: segSnapshot.snapshot,
        finalSnapshotPath: segSnapshot.snapshotPath
      };
    }

    // --- Execute the repair plan ---
    const responseRaw = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(responsePath, "utf-8"))) as AgentHandoffResponse;
    const repairedPlan = responseRaw.plans?.[0];

    if (!repairedPlan) {
      const segSnapshot = await captureSnapshot(input.page, handoffDir, `segment-${segmentIndex}-after`);
      segments.push(buildSegmentRecord({
        segmentIndex,
        decision: { recoveryDecision: "no_safe_action", rationale: "No plan in response" },
        snapshotPath: segSnapshot.snapshotPath,
        executionStatus: "failed",
        error: "No repaired plan in response."
      }));
      return {
        success: false,
        status: "needs_agent",
        segments,
        failedReason: "no_plan",
        failedTarget: input.failedTarget,
        failedAtStep: input.failedAtStep,
        finalSnapshot: segSnapshot.snapshot,
        finalSnapshotPath: segSnapshot.snapshotPath
      };
    }

    const segEvidenceDir = path.join(input.evidenceDir, `segment-${segmentIndex}`);
    const retry = await executeExecutionPlan({
      page: input.page,
      plan: repairedPlan,
      dataContext,
      evidenceDir: segEvidenceDir,
      continueOnFailure: false,
      runtimeConfig: input.fullConfig,
      appBaseUrl: input.fullConfig.app.baseUrl
    });

    const executionStatus = retry.status === "passed" ? "passed" as const : "failed" as const;
    const afterSnapshot = await captureSnapshot(input.page, segEvidenceDir, `segment-${segmentIndex}-after`);
    const selectedCandidateId = repair.diagnostics?.selectedCandidateId;

    // Track failed candidate to prevent loops
    if (selectedCandidateId) {
      failedRoutePaths.push(selectedCandidateId);
    }

    // Look up relation/score from the recovery pack for diagnostics
    const executedCandidate = selectedCandidateId
      ? recoveryPack.topVisibleCandidates.find((c) => c.id === selectedCandidateId)
      : undefined;

    segments.push(buildSegmentRecord({
      segmentIndex,
      decision: { recoveryDecision: "repaired_plan", selectedCandidateId: selectedCandidateId ?? "", action: "click", confidence: 0, sensitive: false, rationale: "" },
      snapshotPath: afterSnapshot.snapshotPath,
      executionStatus,
      candidateText: repair.diagnostics?.selectedCandidateText ?? executedCandidate?.text,
      semanticRelation: executedCandidate?.semanticRelation,
      score: executedCandidate?.score,
      error: executionStatus === "failed" ? `Step execution: ${retry.status}` : undefined
    }));

    if (executionStatus === "passed") {
      // If the plan executed successfully, check if pending targets can now be resolved
      // in the new snapshot. If direct hits exist, this segment resolved the path.
      const nextPack = buildRouteRecoveryPack({
        failedReason: input.failedReason,
        failedTarget: input.failedTarget,
        failedAtStep: input.failedAtStep,
        currentPlan,
        snapshot: afterSnapshot.snapshot,
        scenario: input.scenario,
        budget: input.agentCfg.planningBudget,
        failedRoutePaths
      });

      const nextHit = nextPack.topVisibleCandidates.find(
        (c) => (c.semanticRelation === "exact_match" || c.semanticRelation === "near_match")
          && c.actionability === "clickable"
          && !failedRoutePaths.includes(c.id)
      );

      if (nextHit) {
        if (input.showAgentLog) {
          console.log(`[segment-${segmentIndex}] Post-execution resolved: "${nextHit.text ?? nextHit.type}"`);
        }
        return {
          success: true,
          status: "repaired_passed",
          segments,
          candidatePlan: repairedPlan,
          finalSnapshot: afterSnapshot.snapshot,
          finalSnapshotPath: afterSnapshot.snapshotPath
        };
      }

      // Plan passed but target not directly resolvable; continue to next segment
      currentPlan = repairedPlan;
      currentSnapshot = afterSnapshot.snapshot;
      currentSnapshotPath = afterSnapshot.snapshotPath;
      continue;
    }

    // Execution failed, track and try next segment
    currentSnapshot = afterSnapshot.snapshot;
    currentSnapshotPath = afterSnapshot.snapshotPath;
  }

  return {
    success: false,
    status: "auto_repair_exhausted",
    segments,
    failedReason: "Segmented recovery exhausted after max segments.",
    failedTarget: input.failedTarget,
    failedAtStep: input.failedAtStep
  };
}
