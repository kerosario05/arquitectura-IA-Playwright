/**
 * Pure decision logic for the QA Lab Codex Orchestrator. Never spawns a process, never touches
 * QA Lab source. Given a task, its accumulated state, and the LATEST evidence (a Claude Builder
 * result or a Codex Physical result), returns exactly one next decision.
 *
 * Evidence hierarchy (never let a lower level overwrite a higher-level contradiction):
 *   1. fresh physical QA Lab runtime evidence (CodexPhysicalResult)
 *   2. direct runtime/artifact evidence
 *   3. integration tests
 *   4. focused unit tests (ClaudeResult.tests)
 *   5. static reasoning / prose claims -- NEVER authoritative on their own
 *
 * Termination rule: the task is SUCCESS only when every `task.successCriteria` entry appears in
 * the LATEST evidence's `successCriteriaSatisfied`, AND that evidence is a fresh
 * CodexPhysicalResult when `task.physicalValidationRequired` is true. "tests green" /
 * "readyForPhysicalReplay=true" / "automationReady=true" alone never closes the task.
 */
import type {
  ClaudeResult,
  CodexPhysicalResult,
  CodexDiscoveryResult,
  FirstLoss,
  OrchestratorDecision,
  OrchestratorState,
  TaskContract,
} from "./types";

const DEFAULT_NO_PROGRESS_LIMIT = 3;
export const DEFAULT_QA_LAB_SKILLS = ["qa-lab-low-token-debug", "ponytail", "caveman"];

export function firstLossSignature(firstLoss: FirstLoss | undefined, evidenceSummary: string): string | undefined {
  if (!firstLoss) return undefined;
  return `${firstLoss.file}|${firstLoss.function}|${firstLoss.condition}|${evidenceSummary}`;
}

/** Stable functional fingerprint for loop safety. Invocation timestamps and iteration numbers
 * are intentionally excluded: only changes in actor evidence count as progress. */
export function noProgressEvidenceSignature(evidence: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult, fallbackFrontier?: string): string {
  if (evidence.actor === "CODEX_TESTER") {
    const loss = evidence.firstLoss ? JSON.stringify(evidence.firstLoss).replaceAll(evidence.jobId, "<fresh-job>") : "";
    return JSON.stringify({ actor: evidence.actor, sourceJobId: evidence.sourceJobId, status: evidence.status, appSlug: evidence.appSlug, promotionAllowed: evidence.promotionAllowed, failedGates: [...evidence.failedGates].sort(), firstLoss: loss });
  }
  if (evidence.actor === "CODEX_PHYSICAL") {
    return JSON.stringify({
      actor: evidence.actor,
      firstLoss: evidence.firstLoss ? {
        boundary: evidence.firstLoss.boundary,
        artifact: evidence.firstLoss.artifact,
        reason: evidence.firstLoss.reason,
      } : !evidence.physical.fresh ? {
        boundary: fallbackFrontier ?? "",
        artifact: "stale physical run rejected",
        reason: "physical.fresh=false never satisfies a physical criterion",
      } : null,
      physical: {
        fresh: evidence.physical.fresh,
        freshRunIdReused: evidence.physical.freshRunIdReused ?? false,
        // New run ids are expected progress only for stale/rejected runs. For verified fresh
        // runs, compare outcomes rather than UUIDs so identical no-loss results cannot loop.
        ...(!evidence.physical.fresh ? { freshRunId: evidence.freshRunId } : {}),
        stepsExpected: evidence.physical.stepsExpected,
        stepsExecuted: evidence.physical.stepsExecuted,
        functionalExecution: evidence.physical.functionalExecution,
        causalOutcomeObserved: evidence.physical.causalOutcomeObserved,
      },
      successCriteriaSatisfied: [...evidence.successCriteriaSatisfied].sort(),
      successCriteriaOpen: [...evidence.successCriteriaOpen].sort(),
      humanGate: evidence.humanGate,
      externalBlocker: evidence.externalBlocker,
      sourceChanged: evidence.sourceChanged,
    });
  }
  const builderEvidence = evidence as ClaudeResult;
  return JSON.stringify({
    actor: builderEvidence.actor,
    firstLoss: builderEvidence.firstLoss,
    fix: builderEvidence.fix,
    tests: builderEvidence.tests,
    result: {
      readyForPhysicalReplay: builderEvidence.result.readyForPhysicalReplay,
      successCriteriaSatisfied: [...builderEvidence.result.successCriteriaSatisfied].sort(),
      successCriteriaOpen: [...builderEvidence.result.successCriteriaOpen].sort(),
      humanGate: builderEvidence.result.humanGate,
      externalBlocker: builderEvidence.result.externalBlocker,
    },
  });
}

function priorEquivalentEvidenceCount(state: OrchestratorState, evidence: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult, signature: string): number {
  if (state.lastFirstLossSignature === signature) return state.lastFirstLossRepeatCount;
  // Read checkpoints written by the previous first-loss-only fingerprint format.
  if ((evidence as CodexPhysicalResult).actor === "CODEX_PHYSICAL" && (evidence as CodexPhysicalResult).physical.fresh && (evidence as CodexPhysicalResult).firstLoss) {
    const physicalEvidence = evidence as CodexPhysicalResult;
    const legacySignature = firstLossSignature(
      { file: physicalEvidence.firstLoss!.boundary, function: "", condition: physicalEvidence.firstLoss!.artifact, reason: physicalEvidence.firstLoss!.reason },
      physicalEvidence.firstLoss!.reason,
    );
    if (state.lastFirstLossSignature === legacySignature) return state.lastFirstLossRepeatCount;
  }
  let count = 0;
  for (let index = state.iterations.length - 1; index >= 0; index--) {
    const record = state.iterations[index];
    const prior = record.claudeResult ?? record.codexPhysicalResult ?? record.codexDiscoveryResult;
    if (!prior) continue;
    // A real source edit is progress: results from before that edit are no longer equivalent
    // evidence for the current QA cycle. A Claude review with sourceChanged=false still counts
    // as no progress and must not reset the guard.
    if (prior.actor === "CLAUDE" && prior.result.sourceChanged) break;
    // Builder/tester turns alternate by design. Compare repeated evidence within the same
    // actor lane across the other actor's intervening turn, so an unchanged fresh QA result
    // cannot reset the no-progress guard merely because Claude was asked to review it.
    if (prior.actor !== evidence.actor) continue;
    if (noProgressEvidenceSignature(prior, state.task.currentFrontier) !== signature) break;
    count++;
  }
  return count;
}

export function noProgressRepeatCount(state: OrchestratorState, evidence: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult): number {
  const signature = noProgressEvidenceSignature(evidence, state.task.currentFrontier);
  return priorEquivalentEvidenceCount(state, evidence, signature) + 1;
}

function allSatisfied(task: TaskContract, satisfied: string[]): boolean {
  const set = new Set(satisfied);
  return task.successCriteria.every((criterion) => set.has(criterion));
}

/** Detects the exact contradiction class the ticket calls out: a Claude claim about a DOM
 * attribute condition that isn't backed by the fix's own tests, surfaced so the next Claude
 * prompt must address it instead of being silently accepted. Kept intentionally narrow/generic
 * -- never business-text-specific. */
export function detectClaudeContradiction(result: ClaudeResult): string | undefined {
  if (result.result.readyForPhysicalReplay && result.tests.failed > 0) {
    return `Claude reported readyForPhysicalReplay=true but tests.failed=${result.tests.failed} -- physical evidence can never be requested on a contradicted test result.`;
  }
  if (result.tests.newTypeErrors > 0) {
    return `Claude reported newTypeErrors=${result.tests.newTypeErrors} -- typecheck must return to the pre-existing baseline before any physical dispatch.`;
  }
  return undefined;
}

export function initState(task: TaskContract): OrchestratorState {
  return {
    task,
    iterations: [],
    status: "RUNNING",
    physicalGreens: [...task.physicalGreens],
    lastFirstLossRepeatCount: 0,
  };
}

/**
 * Core decision function. `evidence` is the single latest structured result (or undefined for the
 * very first call, before either actor has run). Never mutates `state` -- callers persist the
 * returned decision plus their own copy of updated repeat-count bookkeeping.
 */
export function decide(
  state: OrchestratorState,
  evidence: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult | undefined,
): OrchestratorDecision {
  const task = state.task;
  const iteration = state.iterations.length + 1;
  const base = (partial: Partial<OrchestratorDecision>): OrchestratorDecision => ({
    actor: "ORCHESTRATOR",
    taskId: task.taskId,
    iteration,
    decision: "CALL_CLAUDE",
    physicalGreensPreserved: state.physicalGreens,
    successCriteriaSatisfied: [],
    successCriteriaOpen: task.successCriteria,
    ...partial,
  });

  // Some tasks make obtaining a fresh physical run the earliest explicit success prerequisite.
  // In that case the evidence collection must precede any source diagnosis; other physical tasks
  // retain the historical Builder-first route.
  if (!evidence) {
    if (task.qaLabReference?.kind === "discovery-job") return base({ decision: "CALL_CLAUDE", nextActor: "CLAUDE_BUILDER", earliestFirstLoss: { boundary: task.currentFrontier, evidence: `historical discovery job=${task.qaLabReference.id}; project=${task.projectSlug ?? "unresolved"}`, reason: "Review the recorded Discovery/Auto-POM failure and apply a source fix before requesting a fresh tester rerun." } });
    if (requiresInitialFreshPhysicalEvidence(task)) {
      const missing: string[] = [];
      if (!task.qaLabBaseUrl) missing.push("TaskContract.qaLabBaseUrl is missing");
      if (!task.projectSlug) missing.push("TaskContract.projectSlug is missing for recording API access");
      if (!task.runtimeUrl) missing.push("TaskContract.runtimeUrl is missing");
      if (!task.steps?.length) missing.push("TaskContract.steps is empty");
      if (missing.length) {
        const reason = `Initial fresh physical evidence is required, but the physical contract is incomplete: ${missing.join("; ")}.`;
        return base({
          decision: "EXTERNAL_BLOCKER",
          stopReasonDetail: reason,
          earliestFirstLoss: { boundary: "CODEX_PHYSICAL physical-run contract", evidence: missing.join("; "), reason },
        });
      }
      return base({
        decision: "CALL_CODEX_PHYSICAL",
        nextActor: "CODEX_PHYSICAL",
        earliestFirstLoss: { boundary: task.currentFrontier, evidence: "fresh physical evidence required by success criteria; none exists", reason: "Obtain the required fresh run before source diagnosis." },
      });
    }
    return base({
      decision: "CALL_CLAUDE",
      nextActor: "CLAUDE_BUILDER",
      earliestFirstLoss: { boundary: task.currentFrontier, evidence: "task definition", reason: "no evidence yet" },
    });
  }

  if (evidence.actor === "CLAUDE" || evidence.actor === "CODEX_BUILDER") {
    if (evidence.result.humanGate) {
      return base({ decision: "HUMAN_GATE", stopReasonDetail: "Claude Builder reported humanGate=true" });
    }
    if (evidence.result.externalBlocker) {
      return base({ decision: "EXTERNAL_BLOCKER", stopReasonDetail: "Claude Builder reported externalBlocker=true" });
    }
    const contradiction = detectClaudeContradiction(evidence);
    if (contradiction) {
      return base({
        decision: "CALL_CLAUDE",
        nextActor: "CLAUDE_BUILDER",
        earliestFirstLoss: { boundary: evidence.firstLoss.file, evidence: "contradiction detected", reason: contradiction },
      });
    }
    // Focused-test/typecheck GREEN and readyForPhysicalReplay=true are necessary, never
    // sufficient. A task requiring physical validation can NEVER reach SUCCESS from a
    // ClaudeResult alone, no matter what successCriteriaSatisfied claims.
    if (task.qaLabReference?.kind === "discovery-job") {
      return base({ decision: "CALL_CODEX_TESTER", nextActor: "CODEX_TESTER", earliestFirstLoss: { boundary: evidence.firstLoss.file, evidence: "Builder result requires a fresh Discovery/Auto-POM rerun", reason: evidence.firstLoss.reason } });
    }
    if (task.physicalValidationRequired) {
      return base({
        decision: "CALL_CODEX_PHYSICAL",
        nextActor: "CODEX_PHYSICAL",
        successCriteriaSatisfied: [],
        successCriteriaOpen: task.successCriteria,
        earliestFirstLoss: { boundary: evidence.firstLoss.file, evidence: "Claude fix pending physical proof", reason: evidence.firstLoss.reason },
      });
    }
    if (allSatisfied(task, evidence.result.successCriteriaSatisfied)) {
      return base({ decision: "SUCCESS", successCriteriaSatisfied: evidence.result.successCriteriaSatisfied, successCriteriaOpen: [] });
    }
    return base({
      decision: "CALL_CLAUDE",
      nextActor: "CLAUDE_BUILDER",
      successCriteriaSatisfied: evidence.result.successCriteriaSatisfied,
      successCriteriaOpen: evidence.result.successCriteriaOpen,
    });
  }

  if (evidence.actor === "CODEX_TESTER") {
    if (evidence.sourceChanged) return base({ decision: "HUMAN_GATE", stopReasonDetail: "Codex Tester source-integrity guard detected a source change." });
    if (evidence.externalBlocker) return base({ decision: "EXTERNAL_BLOCKER", stopReasonDetail: evidence.firstLoss?.reason ?? "Discovery/Auto-POM job failed before a verifiable result was available." });
    if (evidence.status === "passed" && evidence.promotionAllowed && allSatisfied(task, evidence.successCriteriaSatisfied)) return base({ decision: "SUCCESS", successCriteriaSatisfied: evidence.successCriteriaSatisfied, successCriteriaOpen: [] });
    if (noProgressRepeatCount(state, evidence) >= (task.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT)) return base({ decision: "HUMAN_GATE", stopReasonDetail: "NO_PROGRESS_WITH_SAME_EVIDENCE: Discovery/Auto-POM returned equivalent evidence repeatedly." });
    return base({ decision: "CALL_CLAUDE", nextActor: "CLAUDE_BUILDER", successCriteriaSatisfied: evidence.successCriteriaSatisfied, successCriteriaOpen: evidence.successCriteriaOpen, earliestFirstLoss: evidence.firstLoss ?? { boundary: task.currentFrontier, evidence: `new job=${evidence.jobId}; status=${evidence.status}; gates=${evidence.failedGates.join(",")}`, reason: "Review the fresh Discovery/Auto-POM evidence and choose a bounded source fix." } });
  }

  // CodexPhysicalResult -- the highest-authority evidence kind.
  const physicalEvidence = evidence as CodexPhysicalResult;
  if (physicalEvidence.sourceChanged) {
    return base({ decision: "HUMAN_GATE", stopReasonDetail: "Codex Physical repo-change guard: unexpected tracked source delta, never auto-revert." });
  }
  if (physicalEvidence.humanGate) {
    return base({ decision: "HUMAN_GATE", stopReasonDetail: "Codex Physical reported humanGate=true" });
  }
  if (physicalEvidence.externalBlocker) {
    return base({ decision: "EXTERNAL_BLOCKER", stopReasonDetail: "Codex Physical reported externalBlocker=true" });
  }
  // Reconstruct a trailing run from persisted iteration records when older state files predate
  // this fingerprint (or stopped updating it). This lets a resumed legacy loop fail closed.
  const evidenceRepeatCount = noProgressRepeatCount(state, evidence);
  if (!physicalEvidence.physical.fresh || physicalEvidence.physical.freshRunIdReused) {
    // Stale/non-fresh physical evidence can never satisfy a physical criterion (NO FRESH RUN ->
    // NO FUNCTIONAL DIAGNOSIS -> NO FUNCTIONAL FIX). Repeated equivalent stale outcomes stop.
    const limit = task.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT;
    if (evidenceRepeatCount >= limit) {
      return base({
        decision: "HUMAN_GATE",
        stopReasonDetail: `NO_PROGRESS_WITH_SAME_EVIDENCE: equivalent stale physical result repeated ${evidenceRepeatCount} times (limit=${limit}).`,
        earliestFirstLoss: {
          boundary: physicalEvidence.physical.freshRunIdReused ? "CODEX_PHYSICAL run identity" : task.currentFrontier,
          evidence: physicalEvidence.physical.freshRunIdReused ? `reused freshRunId=${physicalEvidence.freshRunId}` : "stale physical run rejected",
          reason: physicalEvidence.physical.freshRunIdReused ? "A run id already persisted for another physical result cannot count as a new run." : "physical.fresh=false never satisfies a physical criterion",
        },
      });
    }
    return base({
      decision: "CALL_CODEX_PHYSICAL",
      nextActor: "CODEX_PHYSICAL",
      earliestFirstLoss: {
        boundary: physicalEvidence.physical.freshRunIdReused ? "CODEX_PHYSICAL run identity" : task.currentFrontier,
        evidence: physicalEvidence.physical.freshRunIdReused ? `reused freshRunId=${physicalEvidence.freshRunId}` : "stale physical run rejected",
        reason: physicalEvidence.physical.freshRunIdReused ? "A run id already persisted for another physical result cannot count as a new run." : "physical.fresh=false never satisfies a physical criterion",
      },
    });
  }
  if (allSatisfied(task, physicalEvidence.successCriteriaSatisfied)) {
    return base({ decision: "SUCCESS", successCriteriaSatisfied: physicalEvidence.successCriteriaSatisfied, successCriteriaOpen: [] });
  }
  if (!physicalEvidence.firstLoss) {
    // Physical run completed fresh but didn't fully satisfy criteria and reported no first-loss
    // -- ambiguous input; let Claude inspect it once, but bound identical physical outcomes.
    const limit = task.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT;
    if (evidenceRepeatCount >= limit) {
      return base({
        decision: "HUMAN_GATE",
        stopReasonDetail: `NO_PROGRESS_WITH_SAME_EVIDENCE: fresh physical result without a first-loss repeated ${evidenceRepeatCount} times (limit=${limit}); no new source or physical evidence justifies another cycle.`,
        successCriteriaSatisfied: physicalEvidence.successCriteriaSatisfied,
        successCriteriaOpen: physicalEvidence.successCriteriaOpen,
      });
    }
    return base({
      decision: "CALL_CLAUDE",
      nextActor: "CLAUDE_BUILDER",
      successCriteriaSatisfied: physicalEvidence.successCriteriaSatisfied,
      successCriteriaOpen: physicalEvidence.successCriteriaOpen,
    });
  }

  const limit = task.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT;
  if (evidenceRepeatCount >= limit) {
    return base({
      decision: "HUMAN_GATE",
      stopReasonDetail: `NO_PROGRESS_WITH_SAME_EVIDENCE: equivalent physical evidence at ${physicalEvidence.firstLoss.boundary} repeated ${evidenceRepeatCount} times (limit=${limit}).`,
    });
  }

  return base({
    decision: "CALL_CLAUDE",
    nextActor: "CLAUDE_BUILDER",
    successCriteriaSatisfied: physicalEvidence.successCriteriaSatisfied,
    successCriteriaOpen: physicalEvidence.successCriteriaOpen,
    earliestFirstLoss: { boundary: physicalEvidence.firstLoss.boundary, evidence: physicalEvidence.firstLoss.artifact, reason: physicalEvidence.firstLoss.reason },
  });
}

/**
 * Identifies a physical-evidence-first task from its explicit leading result contract, rather
 * than treating every physicalValidationRequired task alike. These are result-contract field
 * names, not application-specific values or inferred runtime data.
 */
export function requiresInitialFreshPhysicalEvidence(task: TaskContract): boolean {
  if (!task.physicalValidationRequired) return false;
  const criteria = task.successCriteria.join("\n");
  const normalized = criteria.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const explicitPhysicalResultContract = /\bfresh\s*=\s*true\b/i.test(criteria)
    && /\bfreshRunId\b/i.test(criteria)
    && /\bstepExpected\b|\bstepsExpected\b/i.test(criteria)
    && /\bstepsExecuted\b/i.test(criteria);
  const explicitFreshPhysicalRun = /\b(?:fresh|new|nuevo|nueva|nuevos|nuevas)\b/i.test(normalized)
    && /\b(?:physical|fisica|fisico)\b/i.test(normalized)
    && /\b(?:run|corrida|ejecucion)\b/i.test(normalized);
  return explicitPhysicalResultContract || explicitFreshPhysicalRun;
}

/**
 * DETERMINISTIC GUARD AUTHORITY. The Codex Orchestrator agent (codex-orchestrator-invoker.ts)
 * proposes a decision by REASONING over evidence; this function is the only thing allowed to act
 * on it. `decide()` above remains the ground truth -- computed independently from the same raw
 * evidence, never from the agent's own claims. Any proposal that disagrees with `decide()` on a
 * stop-reason-relevant fact, tries to reopen a physically-GREEN boundary without contradicting
 * evidence in THIS evidence payload, mismatches decision<->nextActor, or whose raw text claims a
 * source edit, is REJECTED -- the deterministic decision is returned instead (fail closed, never
 * "execute anyway"). The agent's only real contribution that survives validation is a RICHER
 * `earliestFirstLoss`/generated prompt when its proposed decision agrees with the deterministic
 * one.
 */
const SOURCE_WRITE_CLAIM_PATTERN = /\b(wrote|edited|modified|patched|updated)\s+(the\s+)?(file|source|code)\b/i;

export function detectSourceWriteClaim(rawAgentText: string): boolean {
  return SOURCE_WRITE_CLAIM_PATTERN.test(rawAgentText);
}

export function validateAgentDecision(
  state: OrchestratorState,
  evidence: ClaudeResult | CodexPhysicalResult | CodexDiscoveryResult | undefined,
  proposal: {
    decision: OrchestratorDecision["decision"];
    earliestFirstLoss?: { boundary: string; evidence: string; reason: string };
    successCriteriaSatisfied: string[];
    successCriteriaOpen: string[];
    nextActor?: OrchestratorDecision["nextActor"];
    claudeEffort?: string;
    claudeEffortReason?: string;
  },
  rawAgentText: string,
): OrchestratorDecision {
  const deterministic = decide(state, evidence);

  if (detectSourceWriteClaim(rawAgentText)) {
    return { ...deterministic, decision: "HUMAN_GATE", stopReasonDetail: "Codex Orchestrator's own output claimed a source edit -- source READ-ONLY violation, fail closed." };
  }
  // decision<->nextActor must agree with what that decision kind requires.
  const nextActorMismatch =
    (proposal.decision === "CALL_CLAUDE" && proposal.nextActor !== "CLAUDE_BUILDER") ||
    (proposal.decision === "CALL_CODEX_PHYSICAL" && proposal.nextActor !== "CODEX_PHYSICAL") ||
    (proposal.decision === "CALL_CODEX_TESTER" && proposal.nextActor !== "CODEX_TESTER");
  if (nextActorMismatch) return deterministic;

  // A Builder HUMAN_GATE is a request for Orchestrator review, not proof that a human is
  // required. The read-only Orchestrator may authorize one more bounded step from the persisted
  // evidence/log context. It may never turn that report into SUCCESS, and repeated identical
  // Builder evidence still terminates through the no-progress guard. Physical/source-integrity
  // gates remain authoritative and cannot be overridden here.
  const builderRequestedHumanReview = evidence?.actor === "CLAUDE"
    && (evidence.result.humanGate || evidence.result.externalBlocker)
    && (deterministic.decision === "HUMAN_GATE" || deterministic.decision === "EXTERNAL_BLOCKER");
  if (builderRequestedHumanReview) {
    const repeatCount = noProgressRepeatCount(state, evidence);
    const repeatLimit = state.task.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT;
    const canContinue = repeatCount < repeatLimit
      && Boolean(proposal.earliestFirstLoss?.boundary.trim())
      && Boolean(proposal.earliestFirstLoss?.evidence.trim())
      && Boolean(proposal.earliestFirstLoss?.reason.trim());
    if (canContinue && proposal.decision === "CALL_CLAUDE" && proposal.nextActor === "CLAUDE_BUILDER") {
      return {
        ...deterministic,
        decision: "CALL_CLAUDE",
        nextActor: "CLAUDE_BUILDER",
        earliestFirstLoss: proposal.earliestFirstLoss,
        stopReasonDetail: undefined,
      };
    }
    if (canContinue && proposal.decision === "CALL_CODEX_PHYSICAL" && proposal.nextActor === "CODEX_PHYSICAL") {
      const contractComplete = Boolean(state.task.steps?.length)
        && Boolean(state.task.qaLabBaseUrl)
        && Boolean(state.task.projectSlug)
        && (!state.task.physicalValidationRequired || Boolean(state.task.runtimeUrl));
      if (contractComplete) {
        return {
          ...deterministic,
          decision: "CALL_CODEX_PHYSICAL",
          nextActor: "CODEX_PHYSICAL",
          earliestFirstLoss: proposal.earliestFirstLoss,
          stopReasonDetail: undefined,
        };
      }
    }
    if (canContinue && proposal.decision === "CALL_CODEX_TESTER" && proposal.nextActor === "CODEX_TESTER") {
      const reference = state.task.qaLabReference;
      if (reference?.kind === "discovery-job" && reference.inputPath && reference.projectSlug) {
        return { ...deterministic, decision: "CALL_CODEX_TESTER", nextActor: "CODEX_TESTER", earliestFirstLoss: proposal.earliestFirstLoss, stopReasonDetail: undefined };
      }
    }
    if (canContinue && proposal.decision === "EXTERNAL_BLOCKER") {
      return {
        ...deterministic,
        decision: "EXTERNAL_BLOCKER",
        earliestFirstLoss: proposal.earliestFirstLoss,
        stopReasonDetail: proposal.earliestFirstLoss!.reason,
      };
    }
    if (!canContinue && repeatCount >= repeatLimit) {
      return {
        ...deterministic,
        stopReasonDetail: `NO_PROGRESS_WITH_SAME_EVIDENCE: identical Builder HUMAN_GATE repeated ${repeatCount} times (limit=${repeatLimit}); Orchestrator review could not justify another bounded action.`,
      };
    }
  }
  // SUCCESS is only ever accepted when the deterministic machine independently agrees.
  if (proposal.decision === "SUCCESS" && deterministic.decision !== "SUCCESS") return deterministic;
  // Never accept a proposed reopening of an already-GREEN boundary unless deterministic() itself
  // (which only sees the SAME evidence) already agrees it's the earliest first-loss.
  if (
    proposal.earliestFirstLoss &&
    state.physicalGreens.includes(proposal.earliestFirstLoss.boundary) &&
    deterministic.earliestFirstLoss?.boundary !== proposal.earliestFirstLoss.boundary
  ) {
    return deterministic;
  }
  if (proposal.decision !== deterministic.decision) return deterministic;

  // Builder policy is fixed: Claude always runs at medium; Codex fallback uses the same effort.
  const claudeEffort: "medium" = "medium";

  return {
    ...deterministic,
    earliestFirstLoss: proposal.earliestFirstLoss ?? deterministic.earliestFirstLoss,
    successCriteriaSatisfied: proposal.successCriteriaSatisfied.length > 0 ? proposal.successCriteriaSatisfied : deterministic.successCriteriaSatisfied,
    successCriteriaOpen: proposal.successCriteriaOpen.length > 0 ? proposal.successCriteriaOpen : deterministic.successCriteriaOpen,
    ...(deterministic.decision === "CALL_CLAUDE"
      ? {
          claudeEffort,
          claudeEffortReason: undefined,
          requiredSkills: (proposal as any).requiredSkills?.length ? (proposal as any).requiredSkills : DEFAULT_QA_LAB_SKILLS,
          requiredPlugins: (proposal as any).requiredPlugins ?? [],
          contextStrategy: (proposal as any).contextStrategy ?? "checkpoint-first (CLAUDE.md/AGENTS.md/docs/ai/00-current-state.md), artifact paths over full logs, one first-loss",
        }
      : {}),
  };
}
