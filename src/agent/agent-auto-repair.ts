import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { FullConfig } from "../types/env.types";
import { buildDataContext } from "../data/data-context";
import { buildAgentHandoffRequest } from "./handoff-builder";
import { writeAgentHandoffPackage } from "./handoff-writer";
import { runCodexAutoRepair } from "./codex-auto-repair";
import { validateAgentHandoffResponse } from "./agent-response-validator";
import { validateExecutionPlan } from "../plans";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { AgentHandoffKind, AgentHandoffResponse } from "../types/agent-handoff.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import { buildAgentContextPack } from "./agent-context-pack";
import { listSupportedActions } from "../registry";
import { selectSkill, getFailedReasonForRouting, isSkillAllowedInBatch } from "./agent-skill-router";
import { writeSelectedSkillFiles } from "./agent-skill-loader";
import { buildSkillAwarePrompt } from "./agent-skill-prompt-builder";
import { buildRouteRecoveryPack, computeRouteRecoveryPackStats } from "./route-recovery-pack";
import { validateRouteRecoveryPlan } from "./agent-response-validator";
import type { CodexAutoRepairInput, PlanningBudget, SemanticGoal, RecoveryDecision } from "../types/codex-auto-repair.types";
import { DEFAULT_PLANNING_BUDGET } from "../types/codex-auto-repair.types";

export type AgentAutoRepairConfig = {
  enabled: boolean;
  provider?: "codex" | "copilot" | "custom";
  command: string;
  extraArgs: string[];
  timeoutMs: number;
  promptMode: "compact" | "verbose" | "compact-route-recovery";
  maxAttempts: number;
  compactPrompt?: boolean;
  promptBudgetSeconds?: number;
  maxCandidates?: number;
  maxProposedActions?: number;
  planningBudget?: PlanningBudget;
};

export type AgentAutoRepairAttemptResult =
  | {
      attempted: true;
      status: "no_proposal";
      success: false;
      reason: string;
      handoffDir: string;
      responsePath: string;
    }
  | {
      attempted: true;
      status: "invalid_proposal" | "cli_error" | "timeout" | "exception" | "no_response";
      success: false;
      reason: string;
      handoffDir: string;
      responsePath: string;
      error?: string;
    }
  | {
      attempted: true;
      status: "validated";
      success: true;
      handoffDir: string;
      responsePath: string;
      repairedPlan: ExecutionPlan;
      warnings: string[];
    };

export function resolveAgentAutoRepairConfig(fullConfig: FullConfig): AgentAutoRepairConfig {
  const agent = fullConfig.integrations.agent;
  const legacy = fullConfig.integrations.codex;

  const enabled = agent?.autoRepairEnabled ?? legacy?.autoRepairEnabled ?? false;
  const command = agent?.command ?? legacy?.command ?? "codex";
  const extraArgsRaw = agent?.extraArgs ?? legacy?.extraArgs ?? "--skip-git-repo-check --sandbox workspace-write";
  const timeoutMs = agent?.autoRepairTimeoutMs ?? legacy?.autoRepairTimeoutMs ?? 900000;
  const promptMode = agent?.autoRepairPromptMode ?? legacy?.autoRepairPromptMode ?? "compact";
  const compactPrompt = agent?.compactPrompt ?? false;
  const maxAttempts = fullConfig.integrations.ai?.discoveryMaxAttempts ?? (compactPrompt ? 1 : 2);
  const promptBudgetSeconds = agent?.promptBudgetSeconds;
  const maxCandidates = agent?.maxCandidates;
  const maxProposedActions = agent?.maxProposedActions;

  const config: AgentAutoRepairConfig = {
    enabled,
    provider: agent?.provider,
    command,
    extraArgs: extraArgsRaw.split(/\s+/).filter(Boolean),
    timeoutMs,
    promptMode: compactPrompt ? "compact-route-recovery" : promptMode,
    maxAttempts,
    compactPrompt,
    promptBudgetSeconds,
    maxCandidates,
    maxProposedActions
  };

  if (config.compactPrompt || config.promptMode === "compact-route-recovery") {
    config.planningBudget = {
      ...DEFAULT_PLANNING_BUDGET,
      ...(promptBudgetSeconds ? { maxPromptBudgetSeconds: promptBudgetSeconds, preferredResponseSeconds: Math.floor(promptBudgetSeconds / 2) } : {}),
      ...(maxCandidates ? { maxCandidates } : {}),
      ...(maxProposedActions ? { maxProposedActions } : {})
    };
  }

  return config;
}

function buildRepairGoal(input: {
  kind: AgentHandoffKind;
  caseId?: number;
  title?: string;
  failureSummary: string;
}): string {
  const id = input.caseId ? `C${input.caseId}` : "case";
  const titlePart = input.title ? ` - ${input.title}` : "";
  return `Repair ${input.kind} for ${id}${titlePart}. Failure: ${input.failureSummary}`;
}

export async function runAgentAutoRepairAttempt(input: {
  fullConfig: FullConfig;
  outputDir: string;
  attemptNumber: number;
  kind: AgentHandoffKind;
  failureSummary: string;
  scenario?: unknown;
  currentPlan?: ExecutionPlan;
  snapshot?: PageSnapshot;
  evidenceDir?: string;
  snapshotPath?: string;
  candidatePlanPath?: string;
  pendingObjectsPath?: string;
  pendingPlansPath?: string;
  failedReason?: string;
  failedTarget?: string;
  failedAtStep?: number;
  repairTimeoutMs?: number;
  showAgentLog?: boolean;
  heartbeatMs?: number;
  compactPrompt?: boolean;
  promptBudgetSeconds?: number;
  maxCandidates?: number;
  maxProposedActions?: number;
  maxAttemptsOverride?: number;
}): Promise<AgentAutoRepairAttemptResult> {
  const cfg = resolveAgentAutoRepairConfig(input.fullConfig);
  if (input.repairTimeoutMs !== undefined) {
    cfg.timeoutMs = input.repairTimeoutMs;
  }
  if (input.compactPrompt) {
    cfg.compactPrompt = true;
    cfg.promptMode = "compact-route-recovery";
  }
  if (input.promptBudgetSeconds !== undefined) {
    cfg.promptBudgetSeconds = input.promptBudgetSeconds;
  }
  if (input.maxCandidates !== undefined) {
    cfg.maxCandidates = input.maxCandidates;
  }
  if (input.maxProposedActions !== undefined) {
    cfg.maxProposedActions = input.maxProposedActions;
  }
  if (input.maxAttemptsOverride !== undefined) {
    cfg.maxAttempts = input.maxAttemptsOverride;
  }
  if (cfg.compactPrompt) {
    cfg.planningBudget = {
      ...DEFAULT_PLANNING_BUDGET,
      ...(cfg.promptBudgetSeconds ? { maxPromptBudgetSeconds: cfg.promptBudgetSeconds, preferredResponseSeconds: Math.floor(cfg.promptBudgetSeconds / 2) } : {}),
      ...(cfg.maxCandidates ? { maxCandidates: cfg.maxCandidates } : {}),
      ...(cfg.maxProposedActions ? { maxProposedActions: cfg.maxProposedActions } : {})
    };
  }
  const attempt = input.attemptNumber;
  console.log(`[auto-repair] Timeout: ${cfg.timeoutMs}ms`);

  if (!cfg.enabled) {
    return {
      attempted: true,
      status: "cli_error",
      success: false,
      reason: "Auto-repair is disabled by configuration.",
      handoffDir: "",
      responsePath: "",
      error: "Auto-repair is disabled."
    };
  }

  const handoffDir = path.join(input.outputDir, `handoff-attempt-${attempt}`);
  await mkdir(handoffDir, { recursive: true });

  const dataContext = buildDataContext(input.fullConfig);

  const contextPackPath = path.join(handoffDir, "context-pack.json");
  try {
    const { pack } = await buildAgentContextPack({
      fullConfig: input.fullConfig,
      outputDir: input.outputDir,
      evidenceDir: input.evidenceDir,
      snapshotPath: input.snapshotPath,
      snapshot: input.snapshot,
      candidatePlanPath: input.candidatePlanPath,
      currentPlan: input.currentPlan,
      pendingObjectsPath: input.pendingObjectsPath,
      pendingPlansPath: input.pendingPlansPath,
      failedReason: input.failedReason,
      failedTarget: input.failedTarget,
      failedAtStep: input.failedAtStep,
      supportedActions: listSupportedActions()
    });
    await writeFile(contextPackPath, JSON.stringify(pack, null, 2), "utf-8");
    console.log("[auto-repair] Building agent context pack...");
    console.log(`[auto-repair] Context pack: ${contextPackPath}`);
    console.log(`[auto-repair] Included known objects: ${pack.knownObjects.length}`);
    console.log(`[auto-repair] Included known plans: ${pack.knownPlans.length}`);
    console.log(`[auto-repair] Included known routes: ${pack.knownRoutes.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[auto-repair] Context pack build warning: ${message}`);
  }

  // --- Bounded route recovery pack (compact mode) ---
  let routeRecoveryPackPath: string | undefined;
  if (cfg.compactPrompt || cfg.promptMode === "compact-route-recovery") {
    try {
      const recoveryPack = buildRouteRecoveryPack({
        failedReason: input.failedReason,
        failedTarget: input.failedTarget,
        failedAtStep: input.failedAtStep,
        currentPlan: input.currentPlan,
        snapshot: input.snapshot,
        contextPack: input.currentPlan || input.snapshot ? undefined : undefined, // Will read from the pack if it was built
        scenario: input.scenario as { title?: string; steps?: Array<{ action: string; target?: string }> } | undefined,
        budget: cfg.planningBudget,
        failedRoutePaths: []
      });
      routeRecoveryPackPath = path.join(handoffDir, "route-recovery-pack.json");
      await writeFile(routeRecoveryPackPath, JSON.stringify(recoveryPack, null, 2), "utf-8");
      const stats = computeRouteRecoveryPackStats(recoveryPack);
      if (input.showAgentLog) {
        console.log(`[auto-repair] Prompt mode: compact-route-recovery`);
        console.log(`[auto-repair] Preferred response: ${cfg.planningBudget?.preferredResponseSeconds ?? 30}s`);
        console.log(`[auto-repair] Prompt budget: ${cfg.planningBudget?.maxPromptBudgetSeconds ?? 60}s`);
        console.log(`[auto-repair] Max candidates: ${cfg.planningBudget?.maxCandidates ?? 12}`);
        console.log(`[auto-repair] Max proposed actions: ${cfg.planningBudget?.maxProposedActions ?? 5}`);
        console.log(`[auto-repair] Route recovery pack: ${routeRecoveryPackPath}`);
        console.log(`[auto-repair] Recovery pack stats: visibleCandidates=${stats.visibleCandidates}, knownObjects=${stats.knownObjects}, knownRoutes=${stats.knownRoutes}, knownPlans=${stats.knownPlans}, pendingSteps=${stats.pendingSteps}, finalAssertions=${stats.finalAssertions}`);
        if (recoveryPack.topVisibleCandidates.length > 0) {
          console.log(`[auto-repair] Top visible candidates:`);
          for (const cand of recoveryPack.topVisibleCandidates.slice(0, 10)) {
            const id = cand.id;
            const txt = cand.text ? `"${cand.text}"` : `"${cand.type}"`;
            const role = cand.role ?? "unknown";
            const act = cand.actionability ?? "unknown";
            const rel = cand.semanticRelation ?? "none";
            console.log(`  ${id} ${txt} role=${role} actionability=${act} score=${cand.score} relation=${rel}`);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[auto-repair] Route recovery pack build warning: ${message}`);
    }
  }

  const failedReason = getFailedReasonForRouting(input.failedReason);
  const skillResult = selectSkill({
    failedReason,
    failedTarget: input.failedTarget,
    hasCandidates: Boolean(input.snapshot?.elements?.length ?? 0 > 0),
    hasPendingAssertions: input.failedReason === "pendingAssertions" || input.failedReason === "assertion_not_found" || input.failedReason === "needs_assertion_resolution",
    isBatchDiscovery: true
  });

  let selectedSkillId = skillResult?.skillId;

  if (selectedSkillId && !isSkillAllowedInBatch(selectedSkillId)) {
    console.log(`[auto-repair] Skill ${selectedSkillId} not allowed in batch, skipping skill routing.`);
    selectedSkillId = undefined;
  }

  if (selectedSkillId) {
    const { mdPath, jsonPath } = await writeSelectedSkillFiles(handoffDir, selectedSkillId, skillResult!.definition);
    console.log(`[auto-repair] Selected skill: ${selectedSkillId}`);
    console.log(`[auto-repair] Skill markdown: ${mdPath}`);
    console.log(`[auto-repair] Skill JSON: ${jsonPath}`);
  } else {
    console.log(`[auto-repair] No skill selected for failedReason: ${input.failedReason ?? "unknown"}`);
  }

  const goal = buildRepairGoal({
    kind: input.kind,
    caseId: (input.currentPlan?.scenario.caseId ?? undefined),
    title: input.currentPlan?.scenario.title,
    failureSummary: input.failureSummary
  });

  const request = buildAgentHandoffRequest({
    kind: input.kind,
    goal,
    contextPackPath,
    scenario: input.scenario as never,
    currentPlan: input.currentPlan,
    snapshot: input.snapshot,
    dataContext,
    selectedSkill: selectedSkillId ? { skillId: selectedSkillId, skillPath: path.join(handoffDir, "selected-skill.md") } : undefined
  });

  const { requestPath, instructionsPath, schemaPath, responsePath } = await writeAgentHandoffPackage({
    request,
    outputDir: handoffDir
  });

  const stdoutLogPath = path.join(handoffDir, "codex.stdout.log");
  const stderrLogPath = path.join(handoffDir, "codex.stderr.log");

  const resultPath = path.join(handoffDir, "auto-repair-result.json");
  const writeAttemptResult = async (payload: Record<string, unknown>): Promise<void> => {
    await writeFile(resultPath, JSON.stringify(payload, null, 2), "utf-8");
  };

  try {
    // For compact-route-recovery, buildCodexPrompt dispatches to
    // buildCompactRouteRecoveryPrompt which already references selected-skill.md.
    // Do not override with skillAwarePromptOverride.
    const skillPrompt = (selectedSkillId && cfg.promptMode !== "compact-route-recovery") ? buildSkillAwarePrompt({
      handoffDir,
      requestPath,
      instructionsPath,
      responsePath,
      schemaPath,
      contextPackPath,
      projectRoot: process.cwd(),
      skillId: selectedSkillId,
      promptMode: cfg.promptMode
    }) : undefined;

    const repair = await runCodexAutoRepair({
      handoffDir,
      requestPath,
      instructionsPath,
      responsePath,
      schemaPath,
      contextPackPath,
      projectRoot: process.cwd(),
      timeoutMs: cfg.timeoutMs,
      codexCommand: cfg.command,
      codexExtraArgs: cfg.extraArgs,
      promptMode: cfg.promptMode,
      skillId: selectedSkillId,
      skillPath: selectedSkillId ? path.join(handoffDir, "selected-skill.md") : undefined,
      skillAwarePromptOverride: skillPrompt,
      showAgentLog: input.showAgentLog ?? false,
      heartbeatMs: input.heartbeatMs,
      stdoutLogPath,
      stderrLogPath,
      attempt,
      compactPrompt: cfg.compactPrompt,
      promptBudgetSeconds: cfg.promptBudgetSeconds,
      maxCandidates: cfg.maxCandidates,
      maxProposedActions: cfg.maxProposedActions,
      maxAttemptsOverride: cfg.maxAttempts,
      routeRecoveryPackPath,
      planningBudget: cfg.planningBudget
    } as CodexAutoRepairInput & { skillAwarePromptOverride?: string });

    if (!repair.success) {
      const error = repair.error ?? "Codex auto-repair failed.";
      const nextAction = repair.diagnostics?.nextAction;
      const isInvalidResponse = nextAction === "auto_repair_invalid_response";
      const status =
        repair.timedOut ? "timeout"
        : nextAction === "auto_repair_no_response" ? "no_response"
        : isInvalidResponse ? "invalid_proposal"
        : (error.toLowerCase().includes("no plans") ? "no_proposal" : "cli_error");
      await writeAttemptResult({
        timestamp: new Date().toISOString(),
        attemptNumber: attempt,
        repairStatus: status,
        success: false,
        error,
        responsePath,
        selectedSkill: selectedSkillId,
        diagnostics: repair.diagnostics
      });

      return {
        attempted: true,
        status: status === "no_proposal" ? "no_proposal" : status,
        success: false,
        reason: error,
        handoffDir,
        responsePath,
        error
      };
    }

    // Handle valid non-plan decisions from compact-route-recovery
    const diagnostics = repair.diagnostics;
    const recoveryDecision = diagnostics?.recoveryDecision;
    if (recoveryDecision === "no_safe_action" || recoveryDecision === "needs_more_context") {
      const message = recoveryDecision === "no_safe_action"
        ? "AI determined no safe action is possible on the current screen."
        : "AI determined more context is needed to propose a safe action.";
      await writeAttemptResult({
        timestamp: new Date().toISOString(),
        attemptNumber: attempt,
        repairStatus: "no_proposal",
        success: false,
        error: message,
        responsePath,
        selectedSkill: selectedSkillId,
        diagnostics: { ...diagnostics, nextAction: recoveryDecision }
      });
      return {
        attempted: true,
        status: "no_proposal",
        success: false,
        reason: message,
        handoffDir,
        responsePath
      };
    }

    const responseRaw = JSON.parse(await readFile(responsePath, "utf-8")) as AgentHandoffResponse;

    const availableKeys = request.dataContextSummary?.availableKeys?.map((k) => (typeof k === "string" ? k : k.key)) ?? [];
    const validation = validateAgentHandoffResponse(responseRaw, { availableDataKeys: availableKeys });
    if (!validation.valid) {
      const message = `Agent response validation failed: ${validation.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`;
      await writeAttemptResult({
        timestamp: new Date().toISOString(),
        attemptNumber: attempt,
        repairStatus: "invalid_proposal",
        success: false,
        error: message,
        responsePath,
        selectedSkill: selectedSkillId,
        diagnostics
      });
      return {
        attempted: true,
        status: "invalid_proposal",
        success: false,
        reason: message,
        handoffDir,
        responsePath,
        error: message
      };
    }

    const repairedPlan = responseRaw.plans?.[0];
    if (!repairedPlan) {
      const message = "AI did not return any repaired plan.";
      await writeAttemptResult({
        timestamp: new Date().toISOString(),
        attemptNumber: attempt,
        repairStatus: "no_proposal",
        success: false,
        error: message,
        responsePath,
        selectedSkill: selectedSkillId,
        diagnostics
      });
      return {
        attempted: true,
        status: "no_proposal",
        success: false,
        reason: message,
        handoffDir,
        responsePath
      };
    }

    const planValidation = validateExecutionPlan(repairedPlan);
    if (!planValidation.valid) {
      const message = `Repaired plan is invalid: ${planValidation.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`;
      await writeAttemptResult({
        timestamp: new Date().toISOString(),
        attemptNumber: attempt,
        repairStatus: "invalid_proposal",
        success: false,
        error: message,
        responsePath,
        selectedSkill: selectedSkillId,
        diagnostics
      });
      return {
        attempted: true,
        status: "invalid_proposal",
        success: false,
        reason: message,
        handoffDir,
        responsePath,
        error: message
      };
    }

    await writeFile(path.join(handoffDir, "repaired-plan.json"), JSON.stringify(repairedPlan, null, 2), "utf-8");
    await writeAttemptResult({
      timestamp: new Date().toISOString(),
      attemptNumber: attempt,
      repairStatus: "validated",
      success: true,
      responsePath,
      selectedSkill: selectedSkillId,
      diagnostics
    });

    return {
      attempted: true,
      status: "validated",
      success: true,
      handoffDir,
      responsePath,
      repairedPlan,
      warnings: planValidation.issues.filter((i) => i.level === "warning").map((i) => i.message)
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeAttemptResult({
      timestamp: new Date().toISOString(),
      attemptNumber: attempt,
      repairStatus: "exception",
      success: false,
      error: message,
      selectedSkill: selectedSkillId
    });
    return {
      attempted: true,
      status: "exception",
      success: false,
      reason: message,
      handoffDir,
      responsePath: path.join(handoffDir, "agent-response.json"),
      error: message
    };
  }
}
