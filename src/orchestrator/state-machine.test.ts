import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { decide, initState, noProgressEvidenceSignature, noProgressRepeatCount, validateAgentDecision } from "./state-machine";
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

function claudeResult(overrides: Partial<ClaudeResult> = {}): ClaudeResult {
  return {
    actor: "CLAUDE",
    taskId: "t1",
    iteration: 1,
    firstLoss: { file: "f.ts", function: "fn", condition: "c", reason: "r" },
    fix: { filesChanged: ["f.ts"], behaviorChanged: true, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
    tests: { passed: 3, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 523 },
    result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: [], humanGate: false, externalBlocker: false },
    ...overrides,
  };
}

function codexResult(overrides: Partial<CodexPhysicalResult> = {}): CodexPhysicalResult {
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

test("CASE 1: readyForPhysicalReplay=true + physicalValidationRequired -> CALL_CODEX_PHYSICAL", () => {
  const state = initState(task());
  const decision = decide(state, claudeResult());
  assert.equal(decision.decision, "CALL_CODEX_PHYSICAL");
  assert.equal(decision.nextActor, "CODEX_PHYSICAL");
});

test("CASE 2: fresh physical FAIL with firstLoss -> CALL_CLAUDE, prompt data carries first-loss, greens preserved", () => {
  const state = initState(task());
  const decision = decide(state, codexResult({ firstLoss: { boundary: "b.ts", artifact: "cond", reason: "why" } }));
  assert.equal(decision.decision, "CALL_CLAUDE");
  assert.equal(decision.earliestFirstLoss?.boundary, "b.ts");
  assert.deepEqual(decision.physicalGreensPreserved, ["boundary-a"]);
});

test("CASE 3: Claude tests GREEN but physical success missing -> never SUCCESS", () => {
  const state = initState(task());
  const decision = decide(state, claudeResult({ result: { readyForPhysicalReplay: true, successCriteriaSatisfied: ["fresh recording created", "webSteps materialized"], successCriteriaOpen: [], humanGate: false, externalBlocker: false } }));
  assert.notEqual(decision.decision, "SUCCESS");
  assert.equal(decision.decision, "CALL_CODEX_PHYSICAL");
});

test("CASE 4: all successCriteria satisfied by a FRESH CodexPhysicalResult -> SUCCESS", () => {
  const state = initState(task());
  const decision = decide(state, codexResult({ successCriteriaSatisfied: ["fresh recording created", "webSteps materialized"] }));
  assert.equal(decision.decision, "SUCCESS");
});

test("CASE 5: humanGate=true (from Claude) -> HUMAN_GATE", () => {
  const state = initState(task());
  const decision = decide(state, claudeResult({ result: { readyForPhysicalReplay: false, successCriteriaSatisfied: [], successCriteriaOpen: [], humanGate: true, externalBlocker: false } }));
  assert.equal(decision.decision, "HUMAN_GATE");
});

test("Claude HUMAN_GATE is a review request: Orchestrator may authorize a bounded Builder continuation, never SUCCESS", () => {
  const gate = claudeResult({ result: { readyForPhysicalReplay: false, successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria, humanGate: true, externalBlocker: false } });
  const state = initState(task());
  const proposal = {
    decision: "CALL_CLAUDE" as const,
    nextActor: "CLAUDE_BUILDER" as const,
    earliestFirstLoss: { boundary: "src/core.ts", evidence: "persisted structural identity is available", reason: "bounded CORE path remains to be implemented and tested" },
    successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria,
  };
  const reviewed = validateAgentDecision(state, gate, proposal, "decision=CALL_CLAUDE");
  assert.equal(reviewed.decision, "CALL_CLAUDE");
  assert.equal(reviewed.nextActor, "CLAUDE_BUILDER");

  const falseSuccess = validateAgentDecision(state, gate, { ...proposal, decision: "SUCCESS", nextActor: undefined }, "decision=SUCCESS");
  assert.equal(falseSuccess.decision, "HUMAN_GATE");
});

test("Claude HUMAN_GATE can route to physical only with a complete project/run contract", () => {
  const gate = claudeResult({ result: { readyForPhysicalReplay: false, successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria, humanGate: true, externalBlocker: false } });
  const proposal = {
    decision: "CALL_CODEX_PHYSICAL" as const,
    nextActor: "CODEX_PHYSICAL" as const,
    earliestFirstLoss: { boundary: "recording runtime", evidence: "fix is ready for fresh replay", reason: "verify through the configured ROKE recorder" },
    successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria,
  };
  const complete = initState(task({ steps: ["step"], qaLabBaseUrl: "http://localhost:3001", runtimeUrl: "https://example.test/", projectSlug: "roke" }));
  assert.equal(validateAgentDecision(complete, gate, proposal, "decision=CALL_CODEX_PHYSICAL").decision, "CALL_CODEX_PHYSICAL");
  const incomplete = initState(task({ steps: ["step"], qaLabBaseUrl: "http://localhost:3001", projectSlug: "roke" }));
  assert.equal(validateAgentDecision(incomplete, gate, proposal, "decision=CALL_CODEX_PHYSICAL").decision, "HUMAN_GATE");
});

test("Codex Physical HUMAN_GATE remains non-overridable by Orchestrator review", () => {
  const gate = codexResult({ humanGate: true });
  const state = initState(task());
  const proposal = {
    decision: "CALL_CLAUDE" as const,
    nextActor: "CLAUDE_BUILDER" as const,
    earliestFirstLoss: { boundary: "source guard", evidence: "physical actor reported source changes", reason: "try anyway" },
    successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria,
  };
  assert.equal(validateAgentDecision(state, gate, proposal, "decision=CALL_CLAUDE").decision, "HUMAN_GATE");
});

test("repeated identical Claude HUMAN_GATE remains fail-closed at no-progress limit", () => {
  const gate = claudeResult({ result: { readyForPhysicalReplay: false, successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria, humanGate: true, externalBlocker: false } });
  const signature = noProgressEvidenceSignature(gate, "frontier-x");
  const state = { ...initState(task()), lastFirstLossSignature: signature, lastFirstLossRepeatCount: 2 };
  const proposal = {
    decision: "CALL_CLAUDE" as const,
    nextActor: "CLAUDE_BUILDER" as const,
    earliestFirstLoss: { boundary: "src/core.ts", evidence: "same result", reason: "try again" },
    successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria,
  };
  const decision = validateAgentDecision(state, gate, proposal, "decision=CALL_CLAUDE");
  assert.equal(decision.decision, "HUMAN_GATE");
  assert.match(decision.stopReasonDetail ?? "", /NO_PROGRESS_WITH_SAME_EVIDENCE/);
});

test("CASE 6: externalBlocker=true (from Codex Physical) -> EXTERNAL_BLOCKER", () => {
  const state = initState(task());
  const decision = decide(state, codexResult({ externalBlocker: true }));
  assert.equal(decision.decision, "EXTERNAL_BLOCKER");
});

test("CASE 7: stale/non-fresh physical run cannot satisfy the physical criterion", () => {
  const state = initState(task());
  const decision = decide(state, codexResult({ physical: { fresh: false, stepsExpected: 5, stepsExecuted: 5, functionalExecution: true, causalOutcomeObserved: true }, successCriteriaSatisfied: ["fresh recording created", "webSteps materialized"] }));
  assert.notEqual(decision.decision, "SUCCESS");
  assert.equal(decision.decision, "CALL_CODEX_PHYSICAL");
});

test("CASE 8: Codex sourceChanged=true -> HUMAN_GATE", () => {
  const state = initState(task());
  const decision = decide(state, codexResult({ sourceChanged: true }));
  assert.equal(decision.decision, "HUMAN_GATE");
  assert.match(decision.stopReasonDetail ?? "", /repo-change guard/i);
});

test("CASE 9: same physical first-loss repeated without new evidence eventually -> HUMAN_GATE (NO_PROGRESS)", () => {
  let state = initState(task({ noProgressLimit: 3 }));
  const sameLoss = { boundary: "b.ts", artifact: "cond", reason: "same reason every time" };
  for (let i = 0; i < 2; i++) {
    const evidence = codexResult({ firstLoss: sameLoss, iteration: i + 1 });
    const decision = decide(state, evidence);
    assert.equal(decision.decision, "CALL_CLAUDE");
    const signature = noProgressEvidenceSignature(evidence, state.task.currentFrontier);
    state = { ...state, iterations: [...state.iterations, { iteration: i + 1, at: `timestamp-${i}`, evidenceKind: "CODEX_PHYSICAL_RESULT", decision, codexPhysicalResult: evidence }], lastFirstLossSignature: signature, lastFirstLossRepeatCount: i + 1 };
  }
  const finalDecision = decide(state, codexResult({ firstLoss: sameLoss, iteration: 99 }));
  assert.equal(finalDecision.decision, "HUMAN_GATE");
  assert.match(finalDecision.stopReasonDetail ?? "", /NO_PROGRESS_WITH_SAME_EVIDENCE/);
});

test("CASE 9b: equivalent fresh physical results without first-loss are bounded across new run ids", () => {
  let state = initState(task({ noProgressLimit: 3 }));
  let finalDecision;
  for (let iteration = 1; iteration <= 3; iteration++) {
    const evidence = codexResult({
      iteration,
      freshRunId: `fresh-run-${iteration}`,
      firstLoss: undefined,
      successCriteriaSatisfied: [],
      successCriteriaOpen: task().successCriteria,
      physical: { fresh: true, stepsExpected: 15, stepsExecuted: 15, functionalExecution: true, causalOutcomeObserved: true },
    });
    finalDecision = decide(state, evidence);
    assert.equal(finalDecision.decision, iteration < 3 ? "CALL_CLAUDE" : "HUMAN_GATE");
    state = {
      ...state,
      iterations: [...state.iterations, {
        iteration,
        at: `timestamp-${iteration}`,
        evidenceKind: "CODEX_PHYSICAL_RESULT",
        codexPhysicalResult: evidence,
        decision: finalDecision,
      }],
    };
  }
  assert.match(finalDecision?.stopReasonDetail ?? "", /NO_PROGRESS_WITH_SAME_EVIDENCE/);
});

function stalePhysical(overrides: Partial<CodexPhysicalResult> = {}): CodexPhysicalResult {
  return codexResult({
    freshRunId: "",
    physical: { fresh: false, stepsExpected: 0, stepsExecuted: 0, functionalExecution: false, causalOutcomeObserved: false },
    successCriteriaSatisfied: [], successCriteriaOpen: [],
    ...overrides,
  });
}

function stateWithPriorEvidence(evidence: CodexPhysicalResult[], noProgressLimit = 3): ReturnType<typeof initState> {
  const initialized = initState(task({ noProgressLimit }));
  const records = evidence.map((item, index) => ({
    iteration: item.iteration,
    at: `different-timestamp-${index}`,
    evidenceKind: "CODEX_PHYSICAL_RESULT" as const,
    decision: { actor: "ORCHESTRATOR" as const, taskId: item.taskId, iteration: item.iteration, decision: "CALL_CODEX_PHYSICAL" as const, nextActor: "CODEX_PHYSICAL" as const, physicalGreensPreserved: initialized.physicalGreens, successCriteriaSatisfied: [], successCriteriaOpen: initialized.task.successCriteria },
    codexPhysicalResult: item,
  }));
  return { ...initialized, iterations: records };
}

test("stale identical physical evidence stops at the configurable limit", () => {
  const evidence = stalePhysical();
  const state = stateWithPriorEvidence([evidence, stalePhysical({ iteration: 3 })], 3);
  const decision = decide(state, stalePhysical({ iteration: 4 }));
  assert.equal(decision.decision, "HUMAN_GATE");
  assert.match(decision.stopReasonDetail ?? "", /NO_PROGRESS_WITH_SAME_EVIDENCE/);
});

test("physical evidence signature ignores timestamps and iteration numbers", () => {
  assert.equal(noProgressEvidenceSignature(stalePhysical({ iteration: 1 })), noProgressEvidenceSignature(stalePhysical({ iteration: 42 })));
});

test("task-specific noProgressLimit is honored", () => {
  const evidence = stalePhysical();
  const state = stateWithPriorEvidence([evidence], 2);
  const decision = decide(state, stalePhysical({ iteration: 3 }));
  assert.equal(decision.decision, "HUMAN_GATE");
});

test("material physical changes reset stale-result repetition and allow another dispatch", () => {
  const base = stalePhysical();
  const prior = [base, stalePhysical({ iteration: 3 })];
  const changes: CodexPhysicalResult[] = [
    stalePhysical({ iteration: 4, freshRunId: "new-run" }),
    stalePhysical({ iteration: 4, physical: { ...base.physical, fresh: true } }),
    stalePhysical({ iteration: 4, physical: { ...base.physical, stepsExecuted: 1 } }),
    stalePhysical({ iteration: 4, firstLoss: { boundary: "new-boundary", artifact: "new artifact", reason: "new reason" } }),
    stalePhysical({ iteration: 4, successCriteriaSatisfied: ["fresh recording created"] }),
  ];
  for (const changedEvidence of changes) {
    const decision = decide(stateWithPriorEvidence(prior), changedEvidence);
    assert.notEqual(decision.decision, "HUMAN_GATE", `material change should reset repetition: ${noProgressEvidenceSignature(changedEvidence)}`);
  }
});

test("legacy capture-visa-authority iterations 6-15 would stop at the configured limit", () => {
  const fixturePath = path.join(__dirname, "fixtures", "capture-visa-authority-stale-physical.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { noProgressLimit: number; results: Array<Omit<CodexPhysicalResult, "taskId" | "humanGate" | "externalBlocker" | "sourceChanged">> };
  const historical = fixture.results.map((result) => stalePhysical({ ...result, taskId: "capture-visa-authority", humanGate: false, externalBlocker: false, sourceChanged: false }));
  const state = stateWithPriorEvidence(historical.slice(0, 2), fixture.noProgressLimit);
  const stop = decide(state, historical[2]);
  assert.equal(stop.decision, "HUMAN_GATE");
  assert.match(stop.stopReasonDetail ?? "", /limit=3/);
  assert.ok(historical.length >= fixture.noProgressLimit);
});

test("CASE 12: physical tasks without an explicit evidence-first contract preserve Builder-first routing", () => {
  const state = initState(task());
  const decision = decide(state, undefined);
  assert.equal(decision.decision, "CALL_CLAUDE");
});

test("initial fresh-evidence prerequisite routes to physical first when the contract is complete", () => {
  const physicalFirstTask = task({
    successCriteria: ["fresh=true", "freshRunId is real", "stepsExpected=5 and stepsExecuted=5", "Functional first-loss diagnosis"],
    steps: ["action A", "action B"], qaLabBaseUrl: "http://qa-lab.test", projectSlug: "qa-project", runtimeUrl: "https://target.test/",
  });
  const decision = decide(initState(physicalFirstTask), undefined);
  assert.equal(decision.decision, "CALL_CODEX_PHYSICAL");
  assert.equal(decision.nextActor, "CODEX_PHYSICAL");
});

test("initial fresh-evidence fields split across separate success criteria still route physical first", () => {
  const physicalFirstTask = task({
    successCriteria: ["fresh=true", "freshRunId real", "stepsExpected=5", "stepsExecuted=5", "technical target authority"],
    steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", projectSlug: "qa-project", runtimeUrl: "https://target.test/",
  });
  const decision = decide(initState(physicalFirstTask), undefined);
  assert.equal(decision.decision, "CALL_CODEX_PHYSICAL");
  assert.equal(decision.nextActor, "CODEX_PHYSICAL");
});

test("initial fresh-evidence prerequisite blocks explicitly when its physical contract is incomplete", () => {
  const physicalFirstTask = task({
    successCriteria: ["fresh=true", "freshRunId is real", "stepsExpected=5 and stepsExecuted=5"],
    steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test",
  });
  const decision = decide(initState(physicalFirstTask), undefined);
  assert.equal(decision.decision, "EXTERNAL_BLOCKER");
  assert.match(decision.stopReasonDetail ?? "", /runtimeUrl is missing/);
});

test("equivalent persisted physical-first task contract routes to Codex Physical", () => {
  const taskFromObservedShape = task({
    objective: "Obtain a fresh physical run and assess observed evidence",
    currentFrontier: "Verify whether the recorder observes actions using fresh evidence",
    successCriteria: ["The recording reports fresh=true", "a real freshRunId", "stepsExpected=5 and stepsExecuted=5", "recorder observes the ordered actions"],
    steps: ["action A", "action B"], qaLabBaseUrl: "http://qa-lab.test", projectSlug: "qa-project", runtimeUrl: "https://target.test/",
  });
  assert.equal(decide(initState(taskFromObservedShape), undefined).decision, "CALL_CODEX_PHYSICAL");
});

test("Spanish fresh physical run criteria route to Codex Physical without requiring English field names", () => {
  const physicalFirstTask = task({
    successCriteria: [
      "Una corrida física nueva alcanza un estado terminal y aporta evidencia fresh",
      "La evidencia identifica la primera pérdida",
    ],
    steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", projectSlug: "qa-project", runtimeUrl: "https://target.test/",
  });
  const decision = decide(initState(physicalFirstTask), undefined);
  assert.equal(decision.decision, "CALL_CODEX_PHYSICAL");
  assert.equal(decision.nextActor, "CODEX_PHYSICAL");
});

test("Codex Orchestrator proposal cannot override physical-first routing with CALL_CLAUDE", () => {
  const state = initState(task({
    successCriteria: ["fresh=true", "freshRunId is real", "stepsExpected=5 and stepsExecuted=5"],
    steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", projectSlug: "qa-project", runtimeUrl: "https://target.test/",
  }));
  const reviewed = validateAgentDecision(state, undefined, {
    decision: "CALL_CLAUDE", nextActor: "CLAUDE_BUILDER", successCriteriaSatisfied: [], successCriteriaOpen: state.task.successCriteria,
  }, "decision=CALL_CLAUDE\nnextActor=CLAUDE_BUILDER");
  assert.equal(reviewed.decision, "CALL_CODEX_PHYSICAL");
  assert.equal(reviewed.nextActor, "CODEX_PHYSICAL");
});

test("Discovery job reference starts with Claude and a failed fresh rerun returns to Claude", () => {
  const discoveryTask = task({
    qaLabReference: { kind: "discovery-job", id: "job-123", inputPath: ".artifacts/scenario-preview-runs/job-123/preview-scenarios.json", projectSlug: "roke" },
    physicalValidationRequired: false,
    successCriteria: ["Spec promoted in ROKE", "Auto-POM ready"],
  });
  const initial = decide(initState(discoveryTask), undefined);
  assert.equal(initial.decision, "CALL_CLAUDE");
  const evidence = {
    actor: "CODEX_TESTER" as const, taskId: discoveryTask.taskId, iteration: 2, sourceJobId: "job-123", jobId: "job-456", appSlug: "roke", status: "failed" as const,
    total: 1, passed: 0, failed: 1, promotionAllowed: false, specWritten: false, automationReady: false,
    failedGates: ["spec_generation_failed"], artifacts: [], firstLoss: { boundary: "spec_generation_failed", evidence: "jobId=job-456", reason: "fresh spec generation failed" },
    successCriteriaSatisfied: [], successCriteriaOpen: discoveryTask.successCriteria, humanGate: false, externalBlocker: false, sourceChanged: false,
  };
  const next = decide({ ...initState(discoveryTask), iterations: [{ iteration: 1, at: "now", evidenceKind: "CLAUDE_RESULT", decision: initial }] }, evidence);
  assert.equal(next.decision, "CALL_CLAUDE");
  assert.match(next.earliestFirstLoss?.evidence ?? "", /job-456/);
});

test("no-progress counts equivalent Discovery results across intervening Claude turns", () => {
  const state = initState(task({ qaLabReference: { kind: "discovery-job", id: "job-123", projectSlug: "roke", inputPath: ".artifacts/job-123/preview-scenarios.json" }, physicalValidationRequired: false }));
  const discovery = {
    actor: "CODEX_TESTER" as const, taskId: state.task.taskId, iteration: 1, sourceJobId: "job-123", jobId: "fresh-a", appSlug: "roke", status: "failed" as const,
    total: 1, passed: 0, failed: 1, promotionAllowed: false, specWritten: false, automationReady: false, failedGates: ["spec_generation_failed"], artifacts: [],
    firstLoss: { boundary: "spec_generation_failed", evidence: "same gate", reason: "same failure" }, successCriteriaSatisfied: [], successCriteriaOpen: state.task.successCriteria,
    humanGate: false, externalBlocker: false, sourceChanged: false,
  };
  const builder: ClaudeResult = { actor: "CLAUDE", taskId: state.task.taskId, iteration: 2, firstLoss: { file: "src/x.ts", function: "f", condition: "same", reason: "same" }, fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false }, tests: { passed: 0, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 }, result: { readyForPhysicalReplay: false, successCriteriaSatisfied: [], successCriteriaOpen: state.task.successCriteria, humanGate: false, externalBlocker: false } };
  const withPrior = { ...state, iterations: [
    { iteration: 1, at: "1", evidenceKind: "CODEX_DISCOVERY_RESULT" as const, codexDiscoveryResult: discovery, decision: decide(state, discovery) },
    { iteration: 2, at: "2", evidenceKind: "CLAUDE_RESULT" as const, claudeResult: builder, decision: decide(state, builder) },
  ] };
  assert.equal(noProgressRepeatCount(withPrior, { ...discovery, iteration: 3, jobId: "fresh-b" }), 2);
});

test("a real Claude source change resets equivalent Discovery no-progress history", () => {
  const state = initState(task({ qaLabReference: { kind: "discovery-job", id: "job-123", projectSlug: "roke", inputPath: ".artifacts/job-123/preview-scenarios.json" }, physicalValidationRequired: false }));
  const discovery = {
    actor: "CODEX_TESTER" as const, taskId: state.task.taskId, iteration: 1, sourceJobId: "job-123", jobId: "fresh-a", appSlug: "roke", status: "failed" as const,
    total: 1, passed: 0, failed: 1, promotionAllowed: false, specWritten: false, automationReady: false, failedGates: ["spec_generation_failed"], artifacts: [],
    firstLoss: { boundary: "spec_generation_failed", evidence: "same gate", reason: "same failure" }, successCriteriaSatisfied: [], successCriteriaOpen: state.task.successCriteria,
    humanGate: false, externalBlocker: false, sourceChanged: false,
  };
  const editedBuilder: ClaudeResult = { actor: "CLAUDE", taskId: state.task.taskId, iteration: 2, firstLoss: { file: "src/x.ts", function: "f", condition: "same", reason: "same" }, fix: { filesChanged: ["src/x.ts"], behaviorChanged: true, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false }, tests: { passed: 1, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 }, result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: state.task.successCriteria, humanGate: false, externalBlocker: false, sourceChanged: true } };
  const withEdit = { ...state, iterations: [
    { iteration: 1, at: "1", evidenceKind: "CODEX_DISCOVERY_RESULT" as const, codexDiscoveryResult: discovery, decision: decide(state, discovery) },
    { iteration: 2, at: "2", evidenceKind: "CLAUDE_RESULT" as const, claudeResult: editedBuilder, decision: decide(state, editedBuilder) },
  ] };
  assert.equal(noProgressRepeatCount(withEdit, { ...discovery, iteration: 3, jobId: "fresh-b" }), 1);
});
