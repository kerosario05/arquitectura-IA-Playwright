/**
 * Drives one OrchestratorState through its loop: LOAD -> EVALUATE -> DECIDE -> (invoke actor) ->
 * persist -> repeat, until SUCCESS/HUMAN_GATE/EXTERNAL_BLOCKER. Never modifies QA Lab source
 * itself -- only ever reads/writes its own state under .artifacts/orchestrator/<taskId>/.
 * Serial execution only: never invokes Claude and Codex Physical concurrently -- each iteration
 * invokes exactly one actor and waits for it before deciding again.
 */
import fs from "node:fs";
import path from "node:path";
import { decide, noProgressEvidenceSignature, noProgressRepeatCount, initState, validateAgentDecision } from "./state-machine";
import { buildClaudePrompt, buildCodexPhysicalPrompt, findForbiddenHints } from "./prompt-builder";
import { getBuilderResultContractErrors, hasBuilderResultContract, parseClaudeResult, parseCodexPhysicalResult } from "./result-parser";
import { classifyClaudeQuotaFailure, hasExplicitBuilderGate, hasExplicitBuilderSourceChange, invokeClaudeBuilder, invokeCodexBuilder, invokeCodexPhysical } from "./actor-invoker";
import { invokeCodexOrchestrator } from "./codex-orchestrator-invoker";
import { prepareQaLabRuntime, waitForRuntimeTarget, type QaLabRuntimeAction } from "./qa-lab-runtime";
import { runDiscoveryRerun } from "./discovery-tester";
import { recoverRecordingPhysicalContract } from "./physical-contract-recovery";
import type {
  ClaudeResult,
  CodexPhysicalResult,
  CodexDiscoveryResult,
  OrchestratorIterationRecord,
  OrchestratorState,
  TaskContract,
  OrchestratorEvent,
} from "./types";

export function stateDir(repoRoot: string, taskId: string): string {
  return path.join(repoRoot, ".artifacts", "orchestrator", taskId);
}

export function loadState(repoRoot: string, task: TaskContract): OrchestratorState {
  const file = path.join(stateDir(repoRoot, task.taskId), "state.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as OrchestratorState;
  return initState(task);
}

export function findLatestFreshPhysicalEvidenceSource(threadStates: OrchestratorState[], task: TaskContract): string | undefined {
  if (!task.physicalValidationRequired || !task.conversationThreadId) return undefined;
  const candidates = threadStates.flatMap((source) => {
    if (source.task.taskId === task.taskId || source.task.conversationThreadId !== task.conversationThreadId) return [];
    if (task.projectSlug && source.task.projectSlug?.toLowerCase() !== task.projectSlug.toLowerCase()) return [];
    if (task.qaLabReference?.kind && source.task.qaLabReference?.kind !== task.qaLabReference.kind) return [];
    const iteration = [...(source.iterations ?? [])].reverse().find((item) => {
      const result = item.codexPhysicalResult;
      return result?.physical.fresh && !!result.freshRunId.trim() && !result.physical.freshRunIdReused;
    });
    return iteration ? [{ taskId: source.task.taskId, at: Date.parse(iteration.at) || 0 }] : [];
  });
  return candidates.sort((a, b) => b.at - a.at)[0]?.taskId;
}

/** Carry forward one real, persisted fresh physical result without rewriting its source checkpoint. */
export function seedFreshPhysicalEvidenceFromTask(
  repoRoot: string,
  state: OrchestratorState,
  sourceTaskId: string,
): OrchestratorState {
  if (state.iterations.length > 0) throw new Error("Physical evidence can only seed a task with no existing iterations.");
  if (!sourceTaskId || sourceTaskId === state.task.taskId) throw new Error("A distinct source task id is required for physical evidence handoff.");
  const sourceFile = path.join(repoRoot, ".artifacts", "orchestrator", sourceTaskId, "state.json");
  if (!fs.existsSync(sourceFile)) throw new Error(`Physical evidence source checkpoint not found: ${sourceTaskId}`);
  const sourceState = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as OrchestratorState;
  const sourceIteration = [...(sourceState.iterations ?? [])].reverse().find((item) => item.codexPhysicalResult);
  const physical = sourceIteration?.codexPhysicalResult;
  if (!physical?.physical.fresh || !physical.freshRunId.trim() || physical.physical.freshRunIdReused) {
    throw new Error(`Task ${sourceTaskId} has no verifiable, unreused fresh Codex Physical result to hand off.`);
  }
  const decision = { ...decide(state, physical), iteration: 0, taskId: state.task.taskId };
  const seeded: OrchestratorState = {
    ...state,
    iterations: [{
      iteration: 0,
      at: sourceIteration!.at,
      evidenceKind: "CODEX_PHYSICAL_RESULT",
      codexPhysicalResult: physical,
      decision,
      evidenceSourceTaskId: sourceTaskId,
    }],
    status: decision.decision === "CALL_CLAUDE" || decision.decision === "CALL_CODEX_PHYSICAL" || decision.decision === "CALL_CODEX_TESTER" ? "RUNNING" : decision.decision,
    physicalGreens: decision.physicalGreensPreserved,
    lastFirstLossSignature: noProgressEvidenceSignature(physical, state.task.currentFrontier),
    lastFirstLossRepeatCount: noProgressRepeatCount(state, physical),
  };
  return seeded;
}

export function saveState(repoRoot: string, state: OrchestratorState): void {
  const dir = stateDir(repoRoot, state.task.taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}

function physicalRunIdAlreadyPersisted(repoRoot: string, runId: string, currentState: OrchestratorState): boolean {
  const root = path.join(repoRoot, ".artifacts", "orchestrator");
  if (!runId || !fs.existsSync(root)) return false;
  if (currentState.iterations.some((item) => item.codexPhysicalResult?.freshRunId === runId)) return true;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const stateFile = path.join(root, entry.name, "state.json");
    if (!fs.existsSync(stateFile)) continue;
    try {
      const persisted = JSON.parse(fs.readFileSync(stateFile, "utf8")) as OrchestratorState;
      if (persisted.iterations?.some((item) => item.codexPhysicalResult?.freshRunId === runId)) return true;
    } catch {
      // A malformed unrelated task checkpoint cannot authorize or invalidate this run id.
    }
  }
  return false;
}

function savePrompt(repoRoot: string, taskId: string, iteration: number, actor: string, text: string): string {
  const dir = path.join(stateDir(repoRoot, taskId), "prompts");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `iteration-${iteration}-${actor}.txt`);
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function saveInvalidActorOutput(repoRoot: string, taskId: string, iteration: number, stdout: string, stderr: string): string {
  const dir = path.join(stateDir(repoRoot, taskId), "actor-results");
  fs.mkdirSync(dir, { recursive: true });
  const artifact = path.join(dir, `iteration-${iteration}-claude-invalid.txt`);
  const sanitized = `[stdout]\n${redactDiagnosticSecrets(stdout)}\n[stderr]\n${redactDiagnosticSecrets(stderr)}`;
  const limit = 32 * 1024;
  fs.writeFileSync(artifact, sanitized.length > limit ? `${sanitized.slice(0, limit)}\n[truncated]` : sanitized, "utf8");
  return artifact;
}

function savePhysicalFailureOutput(repoRoot: string, taskId: string, iteration: number, stdout: string, stderr: string, processError?: string): string {
  const dir = path.join(stateDir(repoRoot, taskId), "actor-results");
  fs.mkdirSync(dir, { recursive: true });
  const artifact = path.join(dir, `iteration-${iteration}-codex-physical-failed.txt`);
  const bounded = (value: string) => {
    const sanitized = Buffer.from(redactDiagnosticSecrets(value), "utf8");
    const limit = 32 * 1024;
    return sanitized.length > limit ? `${sanitized.subarray(0, limit).toString("utf8")}\n[truncated]` : sanitized.toString("utf8");
  };
  fs.writeFileSync(artifact, [
    `[stdout]\n${bounded(stdout)}`,
    `[stderr]\n${bounded(stderr)}`,
    ...(processError ? [`[processError]\n${bounded(processError)}`] : []),
  ].join("\n"), "utf8");
  return artifact;
}

function redactDiagnosticSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED_TOKEN]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|credential|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export type RunOneIterationOptions = {
  dryRun: boolean;
  /** DRY_RUN only: a canned evidence payload to feed decide() instead of invoking a real actor. */
  dryRunEvidence?: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult;
  /** When true, delegates evaluation to the Codex Orchestrator agent (source READ-ONLY,
   * model=gpt-6-luna, effort=medium); its proposal is ALWAYS re-validated by
   * validateAgentDecision before anything is invoked -- never trusted directly. Defaults to
   * false (pure deterministic decide()), since it requires a resolvable Codex CLI in addition to
   * CLAUDE_CLI_COMMAND. */
  useCodexOrchestratorAgent?: boolean;
  onEvent?: (event: OrchestratorEvent) => void;
  actorInvokerOverrides?: {
    codexOrchestrator?: typeof invokeCodexOrchestrator;
    claudeBuilder?: typeof invokeClaudeBuilder;
    codexBuilder?: typeof invokeCodexBuilder;
    codexPhysical?: typeof invokeCodexPhysical;
    qaLabRuntime?: (repoRoot: string, action: QaLabRuntimeAction) => Promise<void>;
    runtimeTargetWait?: typeof waitForRuntimeTarget;
    discoveryTester?: typeof runDiscoveryRerun;
  };
};

export function qaLabRuntimeActionForEvidence(
  evidence: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult | undefined,
  iterations: readonly OrchestratorIterationRecord[] = [],
): QaLabRuntimeAction {
  if (evidence && (evidence.actor === "CLAUDE" || evidence.actor === "CODEX_BUILDER") && evidence.result.sourceChanged) return "restart";
  // A follow-up Builder pass may only add/fix tests and report sourceChanged=false. A prior
  // source edit still requires the target runtime restart until a physical replay has observed it.
  let sourceChangedSincePhysical = false;
  for (const iteration of [...iterations].reverse()) {
    if (iteration.codexPhysicalResult) break;
    if (iteration.claudeResult?.result.sourceChanged) {
      sourceChangedSincePhysical = true;
      break;
    }
  }
  return sourceChangedSincePhysical ? "restart" : "ensure";
}

function emit(options: RunOneIterationOptions, state: OrchestratorState, iteration: number, type: string, summary: string, actor: OrchestratorEvent["actor"] = "ORCHESTRATOR", metadata?: OrchestratorEvent["metadata"]): void {
  options.onEvent?.({ timestamp: new Date().toISOString(), taskId: state.task.taskId, iteration, actor, type, summary, metadata });
}

/**
 * Runs exactly one iteration: decide from the latest recorded evidence, then (unless dryRun)
 * invoke the chosen actor and record its result. Returns the updated state. Callers loop this
 * until state.status !== "RUNNING".
 */
export async function runOneIteration(
  repoRoot: string,
  state: OrchestratorState,
  options: RunOneIterationOptions,
): Promise<OrchestratorState> {
  if (state.status !== "RUNNING") return state;
  const contractRecovery = recoverRecordingPhysicalContract(repoRoot, state.task);
  if (contractRecovery.conflicts.length) {
    const iterationNumber = state.iterations.length + 1;
    const reason = contractRecovery.conflicts.join("; ");
    emit(options, state, iterationNumber, "ACTOR_FAILED", "Recording contract project mismatch; physical actor was not invoked", "ORCHESTRATOR", { reason, recoveredFields: contractRecovery.recoveredFields.join(", ") });
    const decision = decide(state, state.iterations.at(-1)?.claudeResult ?? state.iterations.at(-1)?.codexPhysicalResult);
    return finalizeIteration(repoRoot, state, iterationNumber, {
      ...decision,
      decision: "EXTERNAL_BLOCKER",
      nextActor: undefined,
      earliestFirstLoss: { boundary: "Recording physical contract project", evidence: reason, reason: "The exact recording artifact belongs to another project; project resolution is fail-closed." },
      stopReasonDetail: reason,
    }, undefined, undefined, undefined);
  }
  if (contractRecovery.recoveredFields.length) {
    state = { ...state, task: contractRecovery.task };
    saveState(repoRoot, state);
    emit(options, state, state.iterations.length + 1, "PREFLIGHT_RECOVERED", `Orchestrator restored physical contract fields from the exact recording artifact: ${contractRecovery.recoveredFields.join(", ")}`, "ORCHESTRATOR", { recoveredFields: contractRecovery.recoveredFields.join(", "), recordingId: state.task.qaLabReference?.id });
  }
  const lastIteration = state.iterations[state.iterations.length - 1];
  const latestEvidence = lastIteration?.claudeResult ?? lastIteration?.codexPhysicalResult ?? lastIteration?.codexDiscoveryResult;

  const applyBuilderPreference = (value: ReturnType<typeof decide>) => value.decision === "CALL_CLAUDE" && state.task.builderAgent === "CODEX_BUILDER"
    ? { ...value, nextActor: "CODEX_BUILDER" as const }
    : value;
  let decision = applyBuilderPreference(decide(state, latestEvidence));
  const iterationNumber = state.iterations.length + 1;
  emit(options, state, iterationNumber, "DECISION", `ORCHESTRATOR → ${decision.decision}`, "ORCHESTRATOR", { decision: decision.decision });

  // LIVE POLICY: the Codex Orchestrator agent is ON by default for any non-dry-run iteration --
  // `useCodexOrchestratorAgent: false` is the only opt-out (diagnostic use). If it cannot start,
  // this FAILS CLOSED to EXTERNAL_BLOCKER immediately: it never silently falls back to the
  // deterministic decide() result and invokes Claude/Codex Physical anyway.
  const agentRequired = options.useCodexOrchestratorAgent !== false && !options.dryRun;
  if (agentRequired) {
    emit(options, state, iterationNumber, "ACTOR_STARTED", "Orchestrator está contrastando el contrato con la evidencia persistida", "ORCHESTRATOR", { model: "gpt-6-luna", effort: "medium" });
    let agentOutcome: Awaited<ReturnType<typeof invokeCodexOrchestrator>>;
    try {
      agentOutcome = await (options.actorInvokerOverrides?.codexOrchestrator ?? invokeCodexOrchestrator)(repoRoot, state, latestEvidence);
    } catch (error) {
      const reason = redactDiagnosticSecrets(error instanceof Error ? error.message : String(error)).slice(0, 8 * 1024);
      const firstLoss = { boundary: "CODEX_ORCHESTRATOR evidence review", evidence: reason || "review invocation failed", reason: "Orchestrator review failed before it could authorize an actor; no builder/physical actor was invoked." };
      emit(options, state, iterationNumber, "ACTOR_FAILED", "Orchestrator no pudo completar la revisión; causa persistida", "ORCHESTRATOR", { reason });
      return finalizeIteration(repoRoot, state, iterationNumber, {
        actor: "ORCHESTRATOR",
        taskId: state.task.taskId,
        iteration: iterationNumber,
        decision: "EXTERNAL_BLOCKER",
        physicalGreensPreserved: state.physicalGreens,
        successCriteriaSatisfied: [],
        successCriteriaOpen: state.task.successCriteria,
        earliestFirstLoss: firstLoss,
        stopReasonDetail: reason || firstLoss.reason,
      }, undefined, undefined, undefined, { processError: reason });
    }
    if (!("proposal" in agentOutcome)) {
      const reason = agentOutcome.available === false ? agentOutcome.reason : "unknown";
      emit(options, state, iterationNumber, "ACTOR_FAILED", "Orchestrator no pudo completar la revisión", "ORCHESTRATOR", { reason });
      return finalizeIteration(repoRoot, state, iterationNumber, {
        actor: "ORCHESTRATOR",
        taskId: state.task.taskId,
        iteration: iterationNumber,
        decision: "EXTERNAL_BLOCKER",
        physicalGreensPreserved: state.physicalGreens,
        successCriteriaSatisfied: [],
        successCriteriaOpen: state.task.successCriteria,
        stopReasonDetail: `Codex Orchestrator agent unavailable, fail closed (no actor invoked): ${reason}`,
      }, undefined, undefined, undefined);
    }
    decision = applyBuilderPreference(validateAgentDecision(state, latestEvidence, agentOutcome.proposal, agentOutcome.rawStdout));
    emit(options, state, iterationNumber, "ACTOR_FINISHED", `Orchestrator terminó la revisión · siguiente paso ${decision.decision}`, "ORCHESTRATOR", { decision: decision.decision });
    emit(options, state, iterationNumber, "REVIEW", "ORCHESTRATOR reviewed evidence");
  }

  let claudeResult: ClaudeResult | undefined;
  let codexPhysicalResult: CodexPhysicalResult | undefined;
  let codexDiscoveryResult: CodexDiscoveryResult | undefined;
  let generatedPromptPath: string | undefined;

  if (decision.decision === "CALL_CLAUDE") {
    const boundary = decision.earliestFirstLoss?.boundary ?? state.task.currentFrontier;
    const physicalEvidence = latestEvidence?.actor === "CODEX_PHYSICAL" ? latestEvidence : undefined;
    const builderWorkspaceRoot = state.task.builderWorkspaceRoot
      ? path.resolve(repoRoot, state.task.builderWorkspaceRoot)
      : repoRoot;
    if (!fs.existsSync(builderWorkspaceRoot) || !fs.statSync(builderWorkspaceRoot).isDirectory()) {
      return finalizeIteration(repoRoot, state, iterationNumber, {
        ...decision, decision: "EXTERNAL_BLOCKER",
        stopReasonDetail: `Claude Builder workspace does not exist or is not a directory: ${builderWorkspaceRoot}`,
      }, undefined, undefined, undefined, { requestedActor: "CLAUDE_BUILDER", effectiveActor: "CLAUDE_BUILDER" });
    }
    const prompt = buildClaudePrompt(state.task, decision, builderWorkspaceRoot, physicalEvidence);
    const forbidden = findForbiddenHints(prompt);
    if (forbidden.length > 0) {
      throw new Error(`Generated Claude prompt contains forbidden authority pattern(s): ${forbidden.join(", ")}`);
    }
    const selectedBuilder = state.task.builderAgent ?? "CLAUDE_BUILDER";
    generatedPromptPath = savePrompt(repoRoot, state.task.taskId, iterationNumber, selectedBuilder === "CODEX_BUILDER" ? "codex-builder" : "claude", prompt);
    if (selectedBuilder === "CODEX_BUILDER" && !options.dryRun) {
      const invokeCodex = options.actorInvokerOverrides?.codexBuilder ?? invokeCodexBuilder;
      emit(options, state, iterationNumber, "ACTOR_STARTED", `Codex Builder está trabajando en la frontera: ${boundary}`, "CODEX_BUILDER", { model: "gpt-6-luna", effort: "medium", boundary, requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER", builderPreference: "CODEX_BUILDER" });
      const result = await invokeCodex(repoRoot, prompt);
      if ("reason" in result) {
        emit(options, state, iterationNumber, "ACTOR_FAILED", "Codex Builder no pudo iniciar", "CODEX_BUILDER", { requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER", reason: result.reason });
        return finalizeIteration(repoRoot, state, iterationNumber, { ...decision, decision: "EXTERNAL_BLOCKER", stopReasonDetail: result.reason }, undefined, undefined, generatedPromptPath, { requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER" });
      }
      if (result.exitCode !== 0 || result.timedOut) {
        const reason = `Codex Builder failed (exitCode=${result.exitCode}, timedOut=${result.timedOut}).`;
        emit(options, state, iterationNumber, "ACTOR_FAILED", "Codex Builder terminó sin resultado válido", "CODEX_BUILDER", { requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER", exitCode: result.exitCode, timedOut: result.timedOut });
        return finalizeIteration(repoRoot, state, iterationNumber, { ...decision, decision: "EXTERNAL_BLOCKER", stopReasonDetail: reason }, undefined, undefined, generatedPromptPath, { requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER", processExitCode: result.exitCode });
      }
      if (!hasBuilderResultContract(result.stdout, "CODEX_BUILDER")) {
        const parserError = getBuilderResultContractErrors(result.stdout, "CODEX_BUILDER").join("; ");
        emit(options, state, iterationNumber, "ACTOR_FAILED", "Codex Builder devolvió una salida estructurada inválida", "CODEX_BUILDER", { requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER", parserError });
        return finalizeIteration(repoRoot, state, iterationNumber, { ...decision, decision: "EXTERNAL_BLOCKER", stopReasonDetail: `Codex Builder returned an invalid structured result (${parserError}).` }, undefined, undefined, generatedPromptPath, { requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER", parserError });
      }
      const builderResult = parseClaudeResult(result.stdout, state.task.taskId, iterationNumber, "CODEX_BUILDER");
      emit(options, state, iterationNumber, "ACTOR_FINISHED", `Codex Builder terminó · tests=${builderResult.tests.passed}/${builderResult.tests.passed + builderResult.tests.failed}`, "CODEX_BUILDER", { requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER" });
      return finalizeIteration(repoRoot, state, iterationNumber, decision, builderResult, undefined, generatedPromptPath, { requestedActor: "CODEX_BUILDER", effectiveActor: "CODEX_BUILDER" });
    }
    let effectiveActor: "CLAUDE_BUILDER" | "CODEX_BUILDER" = "CLAUDE_BUILDER";
    let fallbackReason: string | undefined;
    if (options.dryRun) {
      claudeResult = options.dryRunEvidence?.actor === "CLAUDE" ? options.dryRunEvidence : undefined;
    } else {
      const invokeClaude = options.actorInvokerOverrides?.claudeBuilder ?? invokeClaudeBuilder;
      emit(options, state, iterationNumber, "ACTOR_STARTED", `Claude Builder está trabajando en la frontera: ${boundary}`, "CLAUDE_BUILDER", { model: "sonnet", effort: "medium", boundary, requestedActor: "CLAUDE_BUILDER", effectiveActor: "CLAUDE_BUILDER" });
      const spawnResult = await invokeClaude(repoRoot, state.task.taskId, prompt, { model: "sonnet", effort: "medium", workingDirectory: builderWorkspaceRoot });
      if ("reason" in spawnResult) {
        emit(options, state, iterationNumber, "ACTOR_FAILED", "Claude Builder no pudo iniciar", "CLAUDE_BUILDER", { requestedActor: "CLAUDE_BUILDER", effectiveActor: "CLAUDE_BUILDER", reason: spawnResult.reason });
        return finalizeIteration(repoRoot, state, iterationNumber, {
          ...decision,
          decision: "EXTERNAL_BLOCKER",
          stopReasonDetail: spawnResult.reason,
        }, undefined, undefined, generatedPromptPath, { requestedActor: "CLAUDE_BUILDER", effectiveActor: "CLAUDE_BUILDER" });
      }
      if (hasExplicitBuilderGate(spawnResult) || ((spawnResult.exitCode !== 0 || spawnResult.timedOut) && hasExplicitBuilderSourceChange(spawnResult))) {
        claudeResult = parseClaudeResult(spawnResult.stdout, state.task.taskId, iterationNumber, "CLAUDE");
        emit(options, state, iterationNumber, "ACTOR_FINISHED", "Claude result persisted; Orchestrator must review HUMAN_GATE/sourceChanged", "CLAUDE_BUILDER", { requestedActor: "CLAUDE_BUILDER", effectiveActor: "CLAUDE_BUILDER", humanGate: claudeResult.result.humanGate, sourceChanged: claudeResult.result.sourceChanged });
        return finalizeIteration(repoRoot, state, iterationNumber, {
          ...decision,
          // Keep the cycle alive with the structured terminal result persisted. The next
          // iteration is a read-only Orchestrator review; it may route a safe physical retry,
          // request a bounded Builder follow-up, or retain a genuine HUMAN_GATE.
          stopReasonDetail: "Claude reported a gate/source-change condition; awaiting Orchestrator review before deciding whether human intervention is required.",
        }, claudeResult, undefined, generatedPromptPath, { requestedActor: "CLAUDE_BUILDER", effectiveActor: "CLAUDE_BUILDER" });
      }
      const quotaReason = classifyClaudeQuotaFailure(spawnResult);
      let builderOutput = spawnResult.stdout;
      let builderExitCode = spawnResult.exitCode;
      let builderTimedOut = spawnResult.timedOut;
      if (spawnResult.exitCode !== 0 || spawnResult.timedOut) {
        if (!quotaReason) {
          emit(options, state, iterationNumber, "ACTOR_FAILED", `CLAUDE failed · unclassified process error`, "CLAUDE_BUILDER", { requestedActor: "CLAUDE_BUILDER", effectiveActor: "CLAUDE_BUILDER", exitCode: spawnResult.exitCode ?? "unknown", timedOut: spawnResult.timedOut });
          return finalizeIteration(repoRoot, state, iterationNumber, {
            ...decision, decision: "EXTERNAL_BLOCKER",
            stopReasonDetail: `Claude Builder failed without a recognized quota/usage classification (exitCode=${spawnResult.exitCode}, timedOut=${spawnResult.timedOut}); no fallback was attempted.`,
          }, undefined, undefined, generatedPromptPath, { requestedActor: "CLAUDE_BUILDER", effectiveActor: "CLAUDE_BUILDER" });
        }
        effectiveActor = "CODEX_BUILDER";
        fallbackReason = quotaReason;
        emit(options, state, iterationNumber, "FALLBACK", `Claude unavailable (${quotaReason}); Codex Builder starting · gpt-6-luna/medium`, "CODEX_BUILDER", {
          model: "gpt-6-luna", effort: "medium", requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason,
        });
        emit(options, state, iterationNumber, "ACTOR_STARTED", `Codex Builder está continuando el trabajo de Builder en la frontera: ${boundary}`, "CODEX_BUILDER", { model: "gpt-6-luna", effort: "medium", boundary, requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason });
        const invokeCodex = options.actorInvokerOverrides?.codexBuilder ?? invokeCodexBuilder;
        const codexResult = await invokeCodex(repoRoot, prompt);
        if ("reason" in codexResult) {
          emit(options, state, iterationNumber, "ACTOR_FAILED", `CODEX_BUILDER unavailable`, "CODEX_BUILDER", { requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason });
          return finalizeIteration(repoRoot, state, iterationNumber, {
            ...decision, decision: "EXTERNAL_BLOCKER", stopReasonDetail: `Codex Builder fallback unavailable: ${codexResult.reason}`,
          }, undefined, undefined, generatedPromptPath, { requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason });
        }
        builderOutput = codexResult.stdout;
        builderExitCode = codexResult.exitCode;
        builderTimedOut = codexResult.timedOut;
      }
      const expectedResultActor = effectiveActor === "CODEX_BUILDER" ? "CODEX_BUILDER" : "CLAUDE";
      if (builderExitCode !== 0 || builderTimedOut) {
        emit(options, state, iterationNumber, "ACTOR_FAILED", `${effectiveActor} failed`, effectiveActor, { requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason, exitCode: builderExitCode ?? "unknown", timedOut: builderTimedOut });
        return finalizeIteration(repoRoot, state, iterationNumber, {
          ...decision, decision: "EXTERNAL_BLOCKER",
          stopReasonDetail: `${effectiveActor} failed (exitCode=${builderExitCode}, timedOut=${builderTimedOut}).`,
        }, undefined, undefined, generatedPromptPath, { requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason });
      }
      if (!hasBuilderResultContract(builderOutput, expectedResultActor)) {
        const parserErrors = getBuilderResultContractErrors(builderOutput, expectedResultActor);
        const parserError = parserErrors.join("; ");
        const actorResultArtifactPath = effectiveActor === "CLAUDE_BUILDER"
          ? saveInvalidActorOutput(repoRoot, state.task.taskId, iterationNumber, spawnResult.stdout, spawnResult.stderr)
          : undefined;
        emit(options, state, iterationNumber, "ACTOR_FAILED", `${effectiveActor} returned invalid structured output`, effectiveActor, {
          requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason, parserError, actorResultArtifactPath,
        });
        return finalizeIteration(repoRoot, state, iterationNumber, {
          ...decision, decision: "EXTERNAL_BLOCKER",
          stopReasonDetail: `${effectiveActor} returned an invalid structured result (${parserError}); no additional actor was invoked.`,
        }, undefined, undefined, generatedPromptPath, { requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason, parserError, actorResultArtifactPath });
      }
      claudeResult = parseClaudeResult(builderOutput, state.task.taskId, iterationNumber, expectedResultActor);
      emit(options, state, iterationNumber, "ACTOR_FINISHED", `${effectiveActor} finished · tests=${claudeResult.tests.passed}/${claudeResult.tests.passed + claudeResult.tests.failed}`, effectiveActor, {
        requestedActor: "CLAUDE_BUILDER", effectiveActor, fallbackReason,
      });
    }
    if (options.dryRun) emit(options, state, iterationNumber, "ACTOR_FINISHED", "CLAUDE dry-run complete", "CLAUDE_BUILDER", { model: "sonnet", effort: "medium" });
    return finalizeIteration(repoRoot, state, iterationNumber, decision, claudeResult, undefined, generatedPromptPath, {
      requestedActor: "CLAUDE_BUILDER", effectiveActor: claudeResult?.actor === "CODEX_BUILDER" ? "CODEX_BUILDER" : "CLAUDE_BUILDER",
      fallbackReason,
    });
  } else if (decision.decision === "CALL_CODEX_TESTER") {
    const reference = state.task.qaLabReference;
    if (!reference || reference.kind !== "discovery-job" || !reference.inputPath || !reference.projectSlug) {
      const reason = "Discovery/Auto-POM tester cannot run without a validated discovery-job reference, project, and source input artifact.";
      decision = { ...decision, decision: "EXTERNAL_BLOCKER", stopReasonDetail: reason, earliestFirstLoss: { boundary: "Discovery tester contract", evidence: reference?.id ?? "missing reference", reason } };
      return finalizeIteration(repoRoot, state, iterationNumber, decision, undefined, undefined, generatedPromptPath);
    }
    emit(options, state, iterationNumber, "ACTOR_STARTED", `Codex Tester ejecutando Discovery/Auto-POM fresh para ${reference.projectSlug}`, "CODEX_TESTER", { cycle: "discovery-job", sourceJobId: reference.id, projectSlug: reference.projectSlug });
    try {
      if (!options.dryRun) codexDiscoveryResult = await (options.actorInvokerOverrides?.discoveryTester ?? runDiscoveryRerun)(state.task, reference, iterationNumber, (reason, retryInMs) => {
        emit(options, state, iterationNumber, "WAITING_FOR_DEPENDENCY", `QA Lab no está disponible; reintento adaptativo en ${retryInMs} ms`, "CODEX_TESTER", { sourceJobId: reference.id, projectSlug: reference.projectSlug, reason, retryInMs });
      });
      else if (options.dryRunEvidence?.actor === "CODEX_TESTER") codexDiscoveryResult = options.dryRunEvidence;
    } catch (error) {
      const reason = redactDiagnosticSecrets(error instanceof Error ? error.message : String(error)).slice(0, 8 * 1024);
      decision = { ...decision, decision: "EXTERNAL_BLOCKER", stopReasonDetail: reason, earliestFirstLoss: { boundary: "QA Lab Discovery/Auto-POM execution", evidence: reason, reason: "The supported QA Lab rerun/status API failed; no result was fabricated." } };
      emit(options, state, iterationNumber, "ACTOR_FAILED", "Codex Tester no pudo completar el rerun Discovery/Auto-POM", "CODEX_TESTER", { cycle: "discovery-job", sourceJobId: reference.id, projectSlug: reference.projectSlug, reason });
      return finalizeIteration(repoRoot, state, iterationNumber, decision, undefined, undefined, generatedPromptPath, { processError: reason });
    }
    if (codexDiscoveryResult) decision = decide(state, codexDiscoveryResult);
    emit(options, state, iterationNumber, "ACTOR_FINISHED", `Codex Tester terminó · job=${codexDiscoveryResult?.jobId ?? "dry-run"} · status=${codexDiscoveryResult?.status ?? "not-run"}`, "CODEX_TESTER", { cycle: "discovery-job", jobId: codexDiscoveryResult?.jobId, sourceJobId: reference.id, projectSlug: reference.projectSlug, promotionAllowed: codexDiscoveryResult?.promotionAllowed });
  } else if (decision.decision === "CALL_CODEX_PHYSICAL") {
    // Reconcile at the actor boundary as well as iteration start: Builder/intake
    // handoffs may carry a task snapshot that predates recording enrichment.
    const physicalRecovery = recoverRecordingPhysicalContract(repoRoot, state.task);
    if (physicalRecovery.conflicts.length) {
      const reason = physicalRecovery.conflicts.join("; ");
      decision = {
        ...decision,
        decision: "EXTERNAL_BLOCKER",
        nextActor: undefined,
        stopReasonDetail: reason,
        earliestFirstLoss: { boundary: "Recording physical contract project", evidence: reason, reason: "The exact recording artifact belongs to another project; project resolution is fail-closed." },
      };
      emit(options, state, iterationNumber, "ACTOR_FAILED", "Recording contract project mismatch; physical actor was not invoked", "ORCHESTRATOR", { reason });
      return finalizeIteration(repoRoot, state, iterationNumber, decision, undefined, undefined, generatedPromptPath);
    }
    if (physicalRecovery.recoveredFields.length) {
      state = { ...state, task: physicalRecovery.task };
      saveState(repoRoot, state);
      emit(options, state, iterationNumber, "PREFLIGHT_RECOVERED", `Physical preflight restored contract fields from the exact recording artifact: ${physicalRecovery.recoveredFields.join(", ")}`, "ORCHESTRATOR", { recoveredFields: physicalRecovery.recoveredFields.join(", "), recordingId: state.task.qaLabReference?.id });
    }
    emit(options, state, iterationNumber, "PHYSICAL_CONTRACT_PREFLIGHT", "Physical contract checked at the Codex Physical boundary", "ORCHESTRATOR", {
      stepsExpected: state.task.steps?.length ?? 0,
      hasQaLabBaseUrl: Boolean(state.task.qaLabBaseUrl),
      hasRuntimeUrl: Boolean(state.task.runtimeUrl),
      hasProjectSlug: Boolean(state.task.projectSlug),
      recordingId: state.task.qaLabReference?.kind === "recording" ? state.task.qaLabReference.id : "not-recording",
    });
    const missingPhysicalContract: string[] = [];
    if (!state.task.steps?.length) missingPhysicalContract.push("TaskContract.steps is empty");
    if (!state.task.qaLabBaseUrl) missingPhysicalContract.push("TaskContract.qaLabBaseUrl is missing");
    if (!state.task.projectSlug) missingPhysicalContract.push("TaskContract.projectSlug is missing for recording API access");
    if (state.task.physicalValidationRequired && !state.task.runtimeUrl) missingPhysicalContract.push("TaskContract.runtimeUrl is missing for required physical navigation");
    if (missingPhysicalContract.length > 0) {
      const reason = `CODEX_PHYSICAL was not invoked: ${missingPhysicalContract.join("; ")}.`;
      decision = {
        ...decision,
        decision: "EXTERNAL_BLOCKER",
        stopReasonDetail: reason,
        earliestFirstLoss: {
          boundary: "CODEX_PHYSICAL physical-run contract",
          evidence: missingPhysicalContract.join("; "),
          reason: "A fresh recorder-owned physical run cannot be started without explicit ordered steps and the configured QA Lab frontend base URL.",
        },
      };
      emit(options, state, iterationNumber, "ACTOR_FAILED", reason, "CODEX_PHYSICAL");
      return finalizeIteration(repoRoot, state, iterationNumber, decision, undefined, undefined, generatedPromptPath);
    }
    if (!options.dryRun) {
      const runtimeAction = qaLabRuntimeActionForEvidence(latestEvidence, state.iterations);
      emit(options, state, iterationNumber, "ACTOR_STARTED", runtimeAction === "restart" ? "QA Lab reiniciando backend y frontend para validar el fix de source" : "QA Lab comprobando que backend y frontend estén disponibles", "ORCHESTRATOR", { runtimeAction, backendPort: 3002, qaLabBaseUrl: state.task.qaLabBaseUrl });
      try {
        await (options.actorInvokerOverrides?.qaLabRuntime ?? prepareQaLabRuntime)(repoRoot, runtimeAction);
        const runtimeWait = options.actorInvokerOverrides?.runtimeTargetWait
          ?? (options.actorInvokerOverrides?.codexPhysical ? undefined : waitForRuntimeTarget);
        if (state.task.physicalValidationRequired && state.task.runtimeUrl && runtimeWait) {
          await runtimeWait(state.task.runtimeUrl, {
            onWaiting: (attempt, reason) => emit(options, state, iterationNumber, "WAITING_FOR_DEPENDENCY", "Esperando dependencia · runtime de la tarea no disponible; reintento con backoff", "ORCHESTRATOR", { dependency: "runtime-target", attempt, reason: reason.slice(0, 500) }),
            onReady: (attempts) => emit(options, state, iterationNumber, "ACTOR_FINISHED", "Dependencia runtime disponible · continúa la validación fresh", "ORCHESTRATOR", { dependency: "runtime-target", attempts }),
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        decision = {
          ...decision,
          decision: "EXTERNAL_BLOCKER",
          stopReasonDetail: reason,
          earliestFirstLoss: { boundary: "QA Lab service lifecycle", evidence: `runtimeAction=${runtimeAction}`, reason },
        };
        emit(options, state, iterationNumber, "ACTOR_FAILED", reason, "ORCHESTRATOR", { runtimeAction });
        return finalizeIteration(repoRoot, state, iterationNumber, decision, undefined, undefined, generatedPromptPath);
      }
      emit(options, state, iterationNumber, "ACTOR_FINISHED", `QA Lab listo para CODEX_PHYSICAL · action=${runtimeAction}`, "ORCHESTRATOR", { runtimeAction });
    }
    emit(options, state, iterationNumber, "ACTOR_STARTED", `Codex Physical está ejecutando la validación fresh · ${state.task.steps!.length} pasos del contrato`, "CODEX_PHYSICAL", { stepsExpected: state.task.steps!.length });
    const prompt = buildCodexPhysicalPrompt(state.task, decision, repoRoot);
    generatedPromptPath = savePrompt(repoRoot, state.task.taskId, iterationNumber, "codex-physical", prompt);
    if (options.dryRun) {
      codexPhysicalResult = options.dryRunEvidence?.actor === "CODEX_PHYSICAL" ? options.dryRunEvidence : undefined;
    } else {
      const invokePhysical = options.actorInvokerOverrides?.codexPhysical ?? invokeCodexPhysical;
      const spawnResult = await invokePhysical(repoRoot, prompt);
      codexPhysicalResult = parseCodexPhysicalResult(spawnResult.stdout, state.task.taskId, iterationNumber);
      if (codexPhysicalResult.physical.fresh && physicalRunIdAlreadyPersisted(repoRoot, codexPhysicalResult.freshRunId, state)) {
        codexPhysicalResult.physical.freshRunIdReused = true;
      }
      if (codexPhysicalResult.sourceChanged || codexPhysicalResult.humanGate) {
        const reason = codexPhysicalResult.sourceChanged
          ? "CODEX_PHYSICAL repo-change guard reported HUMAN_GATE; source changes require human review."
          : "CODEX_PHYSICAL reported HUMAN_GATE.";
        decision = { ...decision, decision: "HUMAN_GATE", stopReasonDetail: reason };
        emit(options, state, iterationNumber, "ACTOR_FAILED", reason, "CODEX_PHYSICAL", {
          exitCode: spawnResult.exitCode ?? "unknown", freshRunId: codexPhysicalResult.freshRunId,
          sourceChanged: codexPhysicalResult.sourceChanged, humanGate: codexPhysicalResult.humanGate,
        });
        return finalizeIteration(repoRoot, state, iterationNumber, decision, undefined, codexPhysicalResult, generatedPromptPath);
      }
      if (!codexPhysicalResult.physical.fresh || !codexPhysicalResult.freshRunId) {
        const actorResultArtifactPath = spawnResult.exitCode !== 0 || !codexPhysicalResult.freshRunId
          ? savePhysicalFailureOutput(repoRoot, state.task.taskId, iterationNumber, spawnResult.stdout, spawnResult.stderr, spawnResult.processError)
          : undefined;
        const processError = spawnResult.processError ? redactDiagnosticSecrets(spawnResult.processError).slice(0, 32 * 1024) : undefined;
        const evidence = `exitCode=${spawnResult.exitCode}; fresh=${codexPhysicalResult.physical.fresh}; jobId=${codexPhysicalResult.freshRunId || "(missing)"}${processError ? `; processError=${processError}` : ""}`;
        const reason = "CODEX_PHYSICAL ended without a verifiable fresh QA Lab run; no functional diagnosis is permitted.";
        decision = {
          ...decision,
          decision: "EXTERNAL_BLOCKER",
          stopReasonDetail: reason,
          earliestFirstLoss: { boundary: "CODEX_PHYSICAL fresh-run creation", evidence, reason },
        };
        emit(options, state, iterationNumber, "ACTOR_FAILED", reason, "CODEX_PHYSICAL", {
          exitCode: spawnResult.exitCode ?? "unknown", freshRunId: codexPhysicalResult.freshRunId,
          actorResultArtifactPath, processError,
        });
        return finalizeIteration(repoRoot, state, iterationNumber, decision, undefined, undefined, generatedPromptPath, {
          actorResultArtifactPath, processExitCode: spawnResult.exitCode, processError,
        });
      }
      const expectedSteps = state.task.steps!.length;
      const zeroStepsWithoutClassifiedLoss = codexPhysicalResult.physical.stepsExecuted === 0
        && (!codexPhysicalResult.firstLoss || codexPhysicalResult.externalBlocker);
      if (codexPhysicalResult.physical.stepsExpected !== expectedSteps || zeroStepsWithoutClassifiedLoss || codexPhysicalResult.physical.stepsExecuted > expectedSteps) {
        const reason = `Fresh run ${codexPhysicalResult.freshRunId} did not report valid step execution counts (contract=${expectedSteps}, expected=${codexPhysicalResult.physical.stepsExpected}, executed=${codexPhysicalResult.physical.stepsExecuted}).`;
        decision = {
          ...decision,
          decision: "EXTERNAL_BLOCKER",
          stopReasonDetail: reason,
          earliestFirstLoss: { boundary: "CODEX_PHYSICAL step execution contract", evidence: reason, reason: "Physical step counts are missing or inconsistent with the persisted task contract." },
        };
        emit(options, state, iterationNumber, "ACTOR_FAILED", reason, "CODEX_PHYSICAL", { freshRunId: codexPhysicalResult.freshRunId });
        return finalizeIteration(repoRoot, state, iterationNumber, decision, undefined, codexPhysicalResult, generatedPromptPath);
      }
    }
    if (codexPhysicalResult) decision = decide(state, codexPhysicalResult);
    emit(options, state, iterationNumber, "ACTOR_FINISHED", `CODEX PHYSICAL finished · firstLoss=${codexPhysicalResult?.firstLoss?.boundary ?? "none"}`, "CODEX_PHYSICAL", { freshRunId: codexPhysicalResult?.freshRunId, freshRunIdReused: codexPhysicalResult?.physical.freshRunIdReused ?? false });
  }

  return finalizeIteration(repoRoot, state, iterationNumber, decision, claudeResult, codexPhysicalResult, generatedPromptPath, undefined, codexDiscoveryResult);
}

function finalizeIteration(
  repoRoot: string,
  state: OrchestratorState,
  iteration: number,
  decision: OrchestratorState["iterations"][number]["decision"],
  claudeResult: ClaudeResult | undefined,
  codexPhysicalResult: CodexPhysicalResult | undefined,
  generatedPromptPath: string | undefined,
  builderMetadata?: Pick<OrchestratorIterationRecord, "requestedActor" | "effectiveActor" | "fallbackReason" | "actorResultArtifactPath" | "parserError" | "processExitCode" | "processError">,
  codexDiscoveryResult?: CodexDiscoveryResult,
): OrchestratorState {
  const record: OrchestratorIterationRecord = {
    iteration,
    at: new Date().toISOString(),
    evidenceKind: claudeResult ? "CLAUDE_RESULT" : codexPhysicalResult ? "CODEX_PHYSICAL_RESULT" : codexDiscoveryResult ? "CODEX_DISCOVERY_RESULT" : "NONE",
    claudeResult,
    codexPhysicalResult,
    codexDiscoveryResult,
    decision,
    generatedPromptPath,
    ...builderMetadata,
  };
  const result = claudeResult ?? codexPhysicalResult ?? codexDiscoveryResult;
  const signature = result ? noProgressEvidenceSignature(result, state.task.currentFrontier) : state.lastFirstLossSignature;
  const repeatCount = result ? noProgressRepeatCount(state, result) : state.lastFirstLossRepeatCount;
  const nextState: OrchestratorState = {
    ...state,
    iterations: [...state.iterations, record],
    status: decision.decision === "CALL_CLAUDE" || decision.decision === "CALL_CODEX_PHYSICAL" || decision.decision === "CALL_CODEX_TESTER" ? "RUNNING" : decision.decision,
    physicalGreens: decision.physicalGreensPreserved,
    lastFirstLossSignature: signature,
    lastFirstLossRepeatCount: repeatCount,
  };
  saveState(repoRoot, nextState);
  if (decision.decision === "SUCCESS" || decision.decision === "HUMAN_GATE" || decision.decision === "EXTERNAL_BLOCKER") {
    // Event persistence is deliberately best-effort and append-only; state.json remains authority.
    const eventsFile = path.join(stateDir(repoRoot, state.task.taskId), "events.jsonl");
    // The caller writes live events; terminal state is still visible from state.json on resume.
    void eventsFile;
  }
  return nextState;
}
