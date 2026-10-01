import assert from "node:assert/strict";
import test from "node:test";
import { firstLossSignature, initState, validateAgentDecision } from "./state-machine";
import { buildOrchestratorReviewPrompt, buildOrchestratorReviewRunnerInput, buildTaskIntakeRunnerInput, codexOrchestratorArgs, explicitProjectSlugFromUserText, parseOrchestratorProposal } from "./codex-orchestrator-invoker";
import type { ClaudeResult, CodexPhysicalResult, TaskContract } from "./types";

function task(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: "t1",
    objective: "obj",
    successCriteria: ["fresh recording created", "webSteps materialized"],
    physicalValidationRequired: true,
    currentFrontier: "frontier-x",
    physicalGreens: ["boundary-a"],
    allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"],
    ...overrides,
  };
}

function claudeGreenNoPhysical(): ClaudeResult {
  return {
    actor: "CLAUDE",
    taskId: "t1",
    iteration: 1,
    firstLoss: { file: "f.ts", function: "fn", condition: "c", reason: "r" },
    fix: { filesChanged: ["f.ts"], behaviorChanged: true, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
    tests: { passed: 5, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 523 },
    result: { readyForPhysicalReplay: true, successCriteriaSatisfied: ["fresh recording created", "webSteps materialized"], successCriteriaOpen: [], humanGate: false, externalBlocker: false },
  };
}

function codexFresh(overrides: Partial<CodexPhysicalResult> = {}): CodexPhysicalResult {
  return {
    actor: "CODEX_PHYSICAL",
    taskId: "t1",
    iteration: 2,
    freshRunId: "job-1",
    physical: { fresh: true, stepsExpected: 5, stepsExecuted: 5, functionalExecution: true, causalOutcomeObserved: true },
    successCriteriaSatisfied: [],
    successCriteriaOpen: [],
    humanGate: false,
    externalBlocker: false,
    sourceChanged: false,
    ...overrides,
  };
}

test("task intake keeps resolved executable and bounded flags separate from prompt stdin", () => {
  for (const description of ["Resolver un problema de captura", `Resolver un problema ${"evidencia ".repeat(5000)}`]) {
    const input = buildTaskIntakeRunnerInput("C:\\resolved\\codex.cmd", "C:\\repo", description, "context", 300_000);
    assert.strictEqual(input.command, "C:\\resolved\\codex.cmd");
    assert.deepEqual(input.extraArgs, codexOrchestratorArgs());
    assert.strictEqual(input.promptAsStdin, true);
    assert.ok(input.prompt.includes(description));
    assert.ok(input.extraArgs.join(" ").length < 200);
  }
});

test("Orchestrator review sends large checkpoint prompts through stdin without default timeout", () => {
  const prompt = `checkpoint ${"repository instructions ".repeat(20_000)}`;
  const input = buildOrchestratorReviewRunnerInput("C:\\resolved\\codex.cmd", "C:\\repo", prompt);
  assert.equal(input.prompt, prompt);
  assert.equal(input.promptAsStdin, true);
  assert.equal(input.timeoutMs, undefined);
  assert.ok(input.extraArgs.join(" ").length < 200);
});

test("explicit projectSlug in the user request is authoritative over a conflicting quoted project", () => {
  const input = `Attachment says projectSlug=qa\nUse this recording metadata: {"projectSlug":"roke"}`;
  assert.equal(explicitProjectSlugFromUserText(input), "roke");
  assert.equal(explicitProjectSlugFromUserText("No explicit project"), undefined);
});

test("Orchestrator review prompt marks backend logs as diagnostic context, not fresh evidence", () => {
  const prompt = buildOrchestratorReviewPrompt(initState(task()), undefined, "source=qalab-backend.log\nrecording lookup status=ok");
  assert.ok(prompt.includes("QA LAB BACKEND LOG"));
  assert.ok(prompt.includes("recording lookup status=ok"));
  assert.ok(prompt.includes("no es evidencia fresh"));
  assert.match(prompt, /humanGate=true de Claude es una solicitud de revision, no una decision terminal automatica/i);
  assert.match(prompt, /Nunca aceptes SUCCESS desde un Claude HUMAN_GATE/i);
  assert.match(prompt, /HUMAN_GATE de CODEX_PHYSICAL no se pueden anular/i);
});

test("1: Claude tests GREEN, physical missing -> agent proposing SUCCESS is rejected", () => {
  const state = initState(task());
  const evidence = claudeGreenNoPhysical();
  const decision = validateAgentDecision(state, evidence, {
    decision: "SUCCESS",
    successCriteriaSatisfied: evidence.result.successCriteriaSatisfied,
    successCriteriaOpen: [],
  }, "decision=SUCCESS");
  assert.notEqual(decision.decision, "SUCCESS");
  assert.equal(decision.decision, "CALL_CODEX_PHYSICAL");
});

test("2: fresh physical failure -> CALL_CLAUDE, review prompt contains the physical first-loss evidence", () => {
  const state = initState(task());
  const evidence = codexFresh({ firstLoss: { boundary: "b.ts", artifact: "trace.json actionCount=0", reason: "capture never attached" } });
  const prompt = buildOrchestratorReviewPrompt(state, evidence);
  assert.ok(prompt.includes("actionCount=0"));
  const decision = validateAgentDecision(state, evidence, {
    decision: "CALL_CLAUDE",
    earliestFirstLoss: { boundary: "b.ts", evidence: "trace.json actionCount=0", reason: "capture never attached" },
    successCriteriaSatisfied: [],
    successCriteriaOpen: task().successCriteria,
    nextActor: "CLAUDE_BUILDER",
  }, "decision=CALL_CLAUDE");
  assert.equal(decision.decision, "CALL_CLAUDE");
  assert.equal(decision.earliestFirstLoss?.boundary, "b.ts");
});

test("3: stale physical result can never satisfy the criterion, even if the agent claims success", () => {
  const state = initState(task());
  const evidence = codexFresh({ physical: { fresh: false, stepsExpected: 5, stepsExecuted: 5, functionalExecution: true, causalOutcomeObserved: true }, successCriteriaSatisfied: task().successCriteria });
  const decision = validateAgentDecision(state, evidence, { decision: "SUCCESS", successCriteriaSatisfied: task().successCriteria, successCriteriaOpen: [] }, "decision=SUCCESS");
  assert.notEqual(decision.decision, "SUCCESS");
});

test("4: agent tries SUCCESS with open criteria -> deterministic guard rejects", () => {
  const state = initState(task());
  const evidence = codexFresh({ successCriteriaSatisfied: ["fresh recording created"] });
  const decision = validateAgentDecision(state, evidence, {
    decision: "SUCCESS",
    successCriteriaSatisfied: ["fresh recording created"],
    successCriteriaOpen: ["webSteps materialized"],
  }, "decision=SUCCESS");
  assert.notEqual(decision.decision, "SUCCESS");
});

test("5: agent proposes CALL_CLAUDE but nextActor=CODEX_PHYSICAL (inconsistent/parallel-shaped) -> rejected, falls back to deterministic", () => {
  const state = initState(task());
  const evidence = claudeGreenNoPhysical();
  const decision = validateAgentDecision(state, evidence, {
    decision: "CALL_CLAUDE",
    successCriteriaSatisfied: [],
    successCriteriaOpen: task().successCriteria,
    nextActor: "CODEX_PHYSICAL",
  }, "decision=CALL_CLAUDE nextActor=CODEX_PHYSICAL");
  assert.equal(decision.decision, "CALL_CODEX_PHYSICAL");
  assert.equal(decision.nextActor, "CODEX_PHYSICAL");
});

test("6: agent output claims a source edit -> rejected/HUMAN_GATE", () => {
  const state = initState(task());
  const decision = validateAgentDecision(state, undefined, { decision: "CALL_CLAUDE", successCriteriaSatisfied: [], successCriteriaOpen: [], nextActor: "CLAUDE_BUILDER" }, "I wrote the file to fix it.\ndecision=CALL_CLAUDE");
  assert.equal(decision.decision, "HUMAN_GATE");
  assert.match(decision.stopReasonDetail ?? "", /READ-ONLY/);
});

test("7: parsed proposal from a raw agent reply carries exactly one first-loss", () => {
  const raw = [
    "decision=CALL_CLAUDE",
    "earliestFirstLossBoundary=b.ts",
    "earliestFirstLossEvidence=trace.json actionCount=0",
    "earliestFirstLossReason=capture never attached",
    "physicalGreensPreserved=[boundary-a]",
    "successCriteriaSatisfied=[]",
    "successCriteriaOpen=[fresh recording created, webSteps materialized]",
    "nextActor=CLAUDE_BUILDER",
    "CLAUDE_PROMPT_START",
    "$qa-lab-low-token-debug\nFIRST LOSS\nfile=b.ts",
    "CLAUDE_PROMPT_END",
  ].join("\n");
  const proposal = parseOrchestratorProposal(raw);
  assert.equal(proposal.decision, "CALL_CLAUDE");
  assert.equal(proposal.earliestFirstLoss?.boundary, "b.ts");
  assert.ok(proposal.claudePromptDraft?.includes("FIRST LOSS"));
});

test("8: no-progress repeated (deterministic guard) still wins over an agent proposing another CALL_CLAUDE", () => {
  const signature = firstLossSignature({ file: "b.ts", function: "", condition: "art", reason: "same reason" }, "same reason");
  const state = { ...initState(task({ noProgressLimit: 2 })), lastFirstLossSignature: signature, lastFirstLossRepeatCount: 2 };
  const evidence = codexFresh({ firstLoss: { boundary: "b.ts", artifact: "art", reason: "same reason" } });
  const decision = validateAgentDecision(state, evidence, {
    decision: "CALL_CLAUDE",
    earliestFirstLoss: { boundary: "b.ts", evidence: "art", reason: "same reason" },
    successCriteriaSatisfied: [],
    successCriteriaOpen: task().successCriteria,
    nextActor: "CLAUDE_BUILDER",
  }, "decision=CALL_CLAUDE");
  assert.equal(decision.decision, "HUMAN_GATE");
  assert.match(decision.stopReasonDetail ?? "", /NO_PROGRESS/);
});

test("9: all physical success criteria satisfied, agent agrees -> SUCCESS accepted", () => {
  const state = initState(task());
  const evidence = codexFresh({ successCriteriaSatisfied: task().successCriteria });
  const decision = validateAgentDecision(state, evidence, { decision: "SUCCESS", successCriteriaSatisfied: task().successCriteria, successCriteriaOpen: [] }, "decision=SUCCESS");
  assert.equal(decision.decision, "SUCCESS");
});

test("10: dry-run -- agent invoked logically (mocked raw text), decision=CALL_CLAUDE, critical prompt generated", () => {
  const state = initState(task());
  const raw = [
    "decision=CALL_CLAUDE",
    "earliestFirstLossBoundary=capture-attach-boundary",
    "earliestFirstLossEvidence=trace.json actionCount=0",
    "earliestFirstLossReason=playwright-cli page != recorder-owned page, no CDP endpoint exposed",
    "successCriteriaSatisfied=[]",
    "successCriteriaOpen=[fresh recording created]",
    "nextActor=CLAUDE_BUILDER",
    "CLAUDE_PROMPT_START",
    "$qa-lab-low-token-debug\n/ponytail:ponytail full\n/caveman:caveman full\nSTOP.",
    "CLAUDE_PROMPT_END",
  ].join("\n");
  const proposal = parseOrchestratorProposal(raw);
  const decision = validateAgentDecision(state, undefined, proposal, raw);
  assert.equal(decision.decision, "CALL_CLAUDE");
  assert.ok(proposal.claudePromptDraft?.includes("STOP."));
});
