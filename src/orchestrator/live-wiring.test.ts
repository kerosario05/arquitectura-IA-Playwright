import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs } from "../../scripts/qa-lab-orchestrator";
import { decide, initState, validateAgentDecision } from "./state-machine";
import { findLatestFreshPhysicalEvidenceSource, loadState, runOneIteration, saveState, seedFreshPhysicalEvidenceFromTask } from "./orchestrator-runner";
import type { TaskContract } from "./types";

function task(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: "live-t1",
    objective: "obj",
    successCriteria: ["a", "b"],
    physicalValidationRequired: true,
    currentFrontier: "frontier-x",
    physicalGreens: ["green-1"],
    allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"],
    projectSlug: "qa-test-project",
    ...overrides,
  };
}

test("1: LIVE entrypoint -- Codex Orchestrator enabled by default (no flag needed)", () => {
  const args = parseArgs(["--task", "t.json"]);
  assert.equal(args.dryRun, false);
  assert.equal(args.useCodexOrchestratorAgent, true);
});

test("1b: --no-codex-orchestrator is the only opt-out", () => {
  const args = parseArgs(["--task", "t.json", "--no-codex-orchestrator"]);
  assert.equal(args.useCodexOrchestratorAgent, false);
});

test("physical evidence handoff CLI names its source task explicitly", () => {
  const args = parseArgs(["--task", "next.json", "--physical-evidence-from", "prior-task"]);
  assert.equal(args.physicalEvidenceFromTaskId, "prior-task");
});

test("physical evidence handoff seeds only a persisted fresh run and preserves source checkpoint", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-evidence-handoff-"));
  try {
    const sourceTask = task({ taskId: "source-task", successCriteria: ["fresh=true"], physicalValidationRequired: true });
    const sourceState = initState(sourceTask);
    const physical = {
      actor: "CODEX_PHYSICAL" as const, taskId: sourceTask.taskId, iteration: 1, freshRunId: "fresh-run-source",
      physical: { fresh: true, stepsExpected: 5, stepsExecuted: 0, functionalExecution: false, causalOutcomeObserved: false },
      firstLoss: { boundary: "QA Lab frontend API route", artifact: "POST /control returned 404", reason: "Recorder control route is absent from the running QA Lab proxy." },
      successCriteriaSatisfied: [], successCriteriaOpen: sourceTask.successCriteria,
      humanGate: false, externalBlocker: false, sourceChanged: false,
    };
    const source = {
      ...sourceState,
      iterations: [{ iteration: 1, at: "physical-time", evidenceKind: "CODEX_PHYSICAL_RESULT" as const, codexPhysicalResult: physical, decision: decide(sourceState, physical) }],
    };
    saveState(root, source);
    const sourceCheckpoint = fs.readFileSync(path.join(root, ".artifacts", "orchestrator", sourceTask.taskId, "state.json"), "utf8");
    const successorState = initState(task({ taskId: "successor-task", successCriteria: ["fresh=true", "freshRunId is real", "stepsExpected=5 and stepsExecuted=5"] }));
    const seeded = seedFreshPhysicalEvidenceFromTask(root, successorState, sourceTask.taskId);
    assert.equal(seeded.iterations[0].evidenceSourceTaskId, sourceTask.taskId);
    assert.equal(seeded.iterations[0].codexPhysicalResult?.freshRunId, "fresh-run-source");
    assert.equal(seeded.iterations[0].decision.decision, "CALL_CLAUDE");
    assert.equal(seeded.status, "RUNNING");
    assert.equal(fs.readFileSync(path.join(root, ".artifacts", "orchestrator", sourceTask.taskId, "state.json"), "utf8"), sourceCheckpoint);
    assert.throws(() => seedFreshPhysicalEvidenceFromTask(root, initState(task({ taskId: "stale-successor" })), "missing-task"), /checkpoint not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("follow-up evidence source is latest fresh result from same thread, project, and cycle", () => {
  const threadId = "shared-recording-thread";
  const reference = { kind: "recording" as const, id: "recording-seed", projectSlug: "roke" };
  const sourceTask = task({ taskId: "source-task", conversationThreadId: threadId, projectSlug: "roke", qaLabReference: reference });
  const otherProjectTask = task({ taskId: "other-project", conversationThreadId: threadId, projectSlug: "other", qaLabReference: { ...reference, projectSlug: "other" } });
  const successor = task({ taskId: "successor-task", conversationThreadId: threadId, projectSlug: "roke", qaLabReference: reference });
  const physical = {
    actor: "CODEX_PHYSICAL" as const, taskId: sourceTask.taskId, iteration: 1, freshRunId: "fresh-run-thread",
    physical: { fresh: true, stepsExpected: 5, stepsExecuted: 1, functionalExecution: false, causalOutcomeObserved: false },
    firstLoss: { boundary: "source boundary", artifact: "recording artifact", reason: "Actionable first loss." },
    successCriteriaSatisfied: [], successCriteriaOpen: sourceTask.successCriteria,
    humanGate: false, externalBlocker: false, sourceChanged: false,
  };
  const sourceState = { ...initState(sourceTask), iterations: [{ iteration: 1, at: "2026-09-28T15:00:00Z", evidenceKind: "CODEX_PHYSICAL_RESULT" as const, codexPhysicalResult: physical, decision: decide(initState(sourceTask), physical) }] };
  const wrongProjectState = { ...initState(otherProjectTask), iterations: [{ ...sourceState.iterations[0], at: "2026-09-28T16:00:00Z" }] };
  assert.equal(findLatestFreshPhysicalEvidenceSource([sourceState, wrongProjectState], successor), sourceTask.taskId);
  assert.equal(findLatestFreshPhysicalEvidenceSource([{ ...sourceState, iterations: [{ ...sourceState.iterations[0], codexPhysicalResult: { ...physical, physical: { ...physical.physical, freshRunIdReused: true } } }] }], successor), undefined);
});

test("2: Codex Orchestrator unavailable in LIVE -> fail closed to EXTERNAL_BLOCKER, no spawn attempted", async () => {
  // No CODEX_CLI_COMMAND / codex on PATH is assumed unresolvable in this sandboxed test env --
  // exercised through the real invokeCodexOrchestrator resolution path (no mocking needed: a
  // missing/broken Codex CLI IS the unavailable condition this test proves fails closed).
  const savedCodexCliCommand = process.env.CODEX_CLI_COMMAND;
  const savedPath = process.env.PATH;
  process.env.CODEX_CLI_COMMAND = "definitely-not-a-real-codex-binary-xyz";
  process.env.PATH = "";
  try {
    const state = initState(task());
    const result = await runOneIteration(process.cwd(), state, { dryRun: false, useCodexOrchestratorAgent: true });
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    const last = result.iterations[result.iterations.length - 1];
    assert.equal(last.claudeResult, undefined, "Claude must never be invoked when the agent fails closed");
    assert.equal(last.codexPhysicalResult, undefined);
  } finally {
    if (savedCodexCliCommand === undefined) delete process.env.CODEX_CLI_COMMAND; else process.env.CODEX_CLI_COMMAND = savedCodexCliCommand;
    process.env.PATH = savedPath;
  }
});

test("Orchestrator review exceptions persist their cause and never leave a RUNNING phantom task", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-orchestrator-review-error-"));
  try {
    const state = initState(task());
    const result = await runOneIteration(root, state, {
      dryRun: false,
      useCodexOrchestratorAgent: true,
      actorInvokerOverrides: {
        codexOrchestrator: async () => { throw new Error("review parse boundary failed"); },
      },
    });
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.match(result.iterations.at(-1)?.decision.stopReasonDetail ?? "", /review parse boundary failed/);
    assert.equal(result.iterations.at(-1)?.processError, "review parse boundary failed");
    assert.equal(loadState(root, task()).status, "EXTERNAL_BLOCKER");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude HUMAN_GATE is persisted for Orchestrator review before any terminal stop", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-claude-gate-review-"));
  let review = 0;
  let physicalInvoked = false;
  try {
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/", projectSlug: "roke" }));
    const resultText = JSON.stringify({
      actor: "CLAUDE", file: "src/example.ts", function: "inspect", condition: "runtime unavailable", reason: "Builder cannot reach target",
      filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false,
      passed: 1, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0, readyForPhysicalReplay: false,
      successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria,
      humanGate: true, sourceChanged: false, externalBlocker: true,
    });
    const invoke = async (_repoRoot: string, _state: unknown, _evidence: unknown) => {
      review += 1;
      return review === 1
        ? { proposal: { decision: "CALL_CLAUDE" as const, physicalGreensPreserved: [], successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, nextActor: "CLAUDE_BUILDER" as const }, rawStdout: "decision=CALL_CLAUDE" }
        : { proposal: { decision: "CALL_CODEX_PHYSICAL" as const, physicalGreensPreserved: [], earliestFirstLoss: { boundary: "runtime access not verified by verifier", evidence: "Claude session reported inaccessible target", reason: "Use the configured physical verifier to determine whether runtime access is actually external." }, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, nextActor: "CODEX_PHYSICAL" as const }, rawStdout: "decision=CALL_CODEX_PHYSICAL" };
    };
    const first = await runOneIteration(root, initial, {
      dryRun: false, useCodexOrchestratorAgent: true,
      actorInvokerOverrides: {
        codexOrchestrator: invoke,
        claudeBuilder: async () => ({ exitCode: 0, stdout: resultText, stderr: "", timedOut: false, spawnedCommand: "mock" }),
      },
    });
    assert.equal(first.status, "RUNNING");
    assert.equal(first.iterations.at(-1)?.claudeResult?.result.humanGate, true);
    assert.equal(first.iterations.at(-1)?.claudeResult?.result.externalBlocker, true);
    const second = await runOneIteration(root, first, {
      dryRun: false, useCodexOrchestratorAgent: true,
      actorInvokerOverrides: {
        codexOrchestrator: invoke,
        qaLabRuntime: async () => undefined,
        codexPhysical: async () => { physicalInvoked = true; return { exitCode: 1, stdout: "", stderr: "verifier dispatch mocked", timedOut: false, spawnedCommand: "mock" }; },
      },
    });
    assert.equal(physicalInvoked, true, `only the Orchestrator review may authorize verifier dispatch after a Claude gate; status=${second.status} decision=${second.iterations.at(-1)?.decision.decision} reason=${second.iterations.at(-1)?.decision.stopReasonDetail}`);
    assert.equal(second.status, "EXTERNAL_BLOCKER");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("13/14: DRY_RUN never invokes the agent or any actor (no spawn), decision recorded", async () => {
  const state = initState(task());
  const result = await runOneIteration(process.cwd(), state, { dryRun: true });
  assert.equal(result.status, "RUNNING");
  const last = result.iterations[result.iterations.length - 1];
  assert.equal(last.decision.decision, "CALL_CLAUDE");
  assert.equal(last.claudeResult, undefined);
});

test("physical dispatch fails explicitly when the persisted contract has no steps or QA Lab boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-contract-"));
  try {
    const initial = initState(task());
    const staleEvidence = {
      actor: "CODEX_PHYSICAL" as const,
      taskId: initial.task.taskId,
      iteration: 1,
      freshRunId: "",
      physical: { fresh: false, stepsExpected: 0, stepsExecuted: 0, functionalExecution: false, causalOutcomeObserved: false },
      successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria,
      humanGate: false, externalBlocker: false, sourceChanged: false,
    };
    const staleDecision = decide(initial, staleEvidence);
    assert.equal(staleDecision.decision, "CALL_CODEX_PHYSICAL");
    const state = {
      ...initial,
      iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CODEX_PHYSICAL_RESULT" as const, codexPhysicalResult: staleEvidence, decision: staleDecision }],
    };
    const result = await runOneIteration(root, state, { dryRun: true });
    const terminal = result.iterations.at(-1)!;
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.equal(terminal.codexPhysicalResult, undefined);
    assert.match(terminal.decision.earliestFirstLoss?.boundary ?? "", /physical-run contract/);
    assert.match(terminal.decision.stopReasonDetail ?? "", /steps is empty/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("physical dispatch blocks when required physical navigation has no runtimeUrl", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-runtime-url-contract-"));
  try {
    const initial = initState(task({ steps: ["Navigate to the user-supplied target"], qaLabBaseUrl: "http://localhost:3001" }));
    const staleEvidence = {
      actor: "CODEX_PHYSICAL" as const, taskId: initial.task.taskId, iteration: 1, freshRunId: "old-run",
      physical: { fresh: false, stepsExpected: 0, stepsExecuted: 0, functionalExecution: false, causalOutcomeObserved: false },
      successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria,
      humanGate: false, externalBlocker: false, sourceChanged: false,
    };
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CODEX_PHYSICAL_RESULT" as const, codexPhysicalResult: staleEvidence, decision: decide(initial, staleEvidence) }] };
    const result = await runOneIteration(root, state, { dryRun: true });
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.match(result.iterations.at(-1)?.decision.stopReasonDetail ?? "", /runtimeUrl is missing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("physical dispatch blocks explicitly when QA Lab projectSlug is missing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-project-slug-contract-"));
  try {
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://localhost:3001", runtimeUrl: "https://target.test/", projectSlug: undefined }));
    const claudeResult = {
      actor: "CLAUDE" as const, taskId: initial.task.taskId, iteration: 1,
      firstLoss: { file: "src/example.ts", function: "inspect", condition: "needed", reason: "first" },
      fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
      tests: { passed: 1, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 },
      result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, humanGate: false, externalBlocker: false },
    };
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CLAUDE_RESULT" as const, claudeResult, decision: decide(initial, claudeResult) }] };
    const result = await runOneIteration(root, state, { dryRun: true });
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.match(result.iterations.at(-1)?.decision.stopReasonDetail ?? "", /TaskContract\.projectSlug is missing/);
    assert.equal(result.iterations.at(-1)?.codexPhysicalResult, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("first evidence-first physical task dispatches only to Codex Physical, not Claude Builder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-first-routing-"));
  const events: Array<{ actor: string; type: string; summary?: string }> = [];
  try {
    const initial = initState(task({
      objective: "Obtain a fresh physical run and assess evidence",
      currentFrontier: "Verify recorder evidence from a fresh run",
      successCriteria: ["fresh=true", "freshRunId is real", "stepsExpected=5 and stepsExecuted=5", "recorder captures the actions"],
      steps: ["action A", "action B"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/",
    }));
    const result = await runOneIteration(root, initial, {
      dryRun: true,
      onEvent: (event) => events.push({ actor: event.actor, type: event.type, summary: event.summary }),
    });
    assert.equal(result.iterations.at(-1)?.decision.decision, "CALL_CODEX_PHYSICAL");
    assert.ok(events.some((event) => event.actor === "CODEX_PHYSICAL" && event.type === "ACTOR_STARTED"));
    assert.match(events.find((event) => event.actor === "CODEX_PHYSICAL" && event.type === "ACTOR_STARTED")?.summary ?? "", /fresh.*2 pasos/i);
    assert.ok(!events.some((event) => event.actor === "CLAUDE_BUILDER" && event.type === "ACTOR_STARTED"));
    assert.match(result.iterations.at(-1)?.generatedPromptPath ?? "", /codex-physical/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("physical nonzero exit persists bounded redacted process diagnostics and remains fail-closed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-process-failure-"));
  const events: Array<{ metadata?: Record<string, string | number | boolean | undefined> }> = [];
  try {
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/" }));
    const claudeResult = {
      actor: "CLAUDE" as const, taskId: initial.task.taskId, iteration: 1,
      firstLoss: { file: "src/example.ts", function: "inspect", condition: "needed", reason: "first" },
      fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
      tests: { passed: 0, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 },
      result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, humanGate: false, externalBlocker: false },
    };
    const priorDecision = decide(initial, claudeResult);
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CLAUDE_RESULT" as const, claudeResult, decision: priorDecision }] };
    const result = await runOneIteration(root, state, {
      dryRun: false,
      useCodexOrchestratorAgent: false,
      onEvent: (event) => events.push({ metadata: event.metadata }),
      actorInvokerOverrides: {
        qaLabRuntime: async () => undefined,
        codexPhysical: async () => ({
          exitCode: 1, stdout: "runner failed api_key=physical-secret", stderr: "Bearer stderr-secret",
          processError: "wrapper startup diagnostic", timedOut: false, spawnedCommand: "mock",
        }),
      },
    });
    const iteration = result.iterations.at(-1)!;
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.equal(iteration.evidenceKind, "NONE");
    assert.equal(iteration.codexPhysicalResult, undefined);
    assert.equal(iteration.processExitCode, 1);
    assert.equal(iteration.processError, "wrapper startup diagnostic");
    assert.ok(iteration.actorResultArtifactPath);
    const artifact = fs.readFileSync(iteration.actorResultArtifactPath!, "utf8");
    assert.match(artifact, /runner failed api_key=\[REDACTED\]/);
    assert.match(artifact, /Bearer \[REDACTED\]/);
    assert.match(artifact, /wrapper startup diagnostic/);
    assert.doesNotMatch(artifact, /physical-secret|stderr-secret/);
    assert.ok(artifact.length < 32 * 1024 * 3);
    assert.equal(events.at(-1)?.metadata?.actorResultArtifactPath, iteration.actorResultArtifactPath);
    assert.equal(events.at(-1)?.metadata?.processError, "wrapper startup diagnostic");
    const persisted = JSON.parse(fs.readFileSync(path.join(root, ".artifacts", "orchestrator", initial.task.taskId, "state.json"), "utf8"));
    assert.equal(persisted.iterations.at(-1).processExitCode, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("zero-exit physical output without freshRunId persists its diagnostic artifact and remains fail-closed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-missing-job-id-"));
  try {
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/" }));
    const claudeResult = {
      actor: "CLAUDE" as const, taskId: initial.task.taskId, iteration: 1,
      firstLoss: { file: "src/example.ts", function: "inspect", condition: "needed", reason: "first" },
      fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
      tests: { passed: 0, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 },
      result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, humanGate: false, externalBlocker: false },
    };
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CLAUDE_RESULT" as const, claudeResult, decision: decide(initial, claudeResult) }] };
    const output = "FRESH RUN\njobId=\nstatus=not_created\nstepsExpected=1\nstepsExecuted=\nFIRST LOSS\nreason=recorder start failed";
    const result = await runOneIteration(root, state, {
      dryRun: false, useCodexOrchestratorAgent: false,
      actorInvokerOverrides: { qaLabRuntime: async () => undefined, codexPhysical: async () => ({ exitCode: 0, stdout: output, stderr: "", timedOut: false, spawnedCommand: "mock" }) },
    });
    const iteration = result.iterations.at(-1)!;
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.equal(iteration.processExitCode, 0);
    assert.ok(iteration.actorResultArtifactPath);
    const artifact = fs.readFileSync(iteration.actorResultArtifactPath!, "utf8");
    assert.match(artifact, /status=not_created/);
    assert.match(artifact, /recorder start failed/);
    assert.equal(iteration.codexPhysicalResult, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("successful fresh physical process still persists its parsed run result", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-process-success-"));
  try {
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/" }));
    const claudeResult = {
      actor: "CLAUDE" as const, taskId: initial.task.taskId, iteration: 1,
      firstLoss: { file: "src/example.ts", function: "inspect", condition: "needed", reason: "first" },
      fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
      tests: { passed: 1, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 },
      result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, humanGate: false, externalBlocker: false },
    };
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CLAUDE_RESULT" as const, claudeResult, decision: decide(initial, claudeResult) }] };
    const result = await runOneIteration(root, state, {
      dryRun: false,
      useCodexOrchestratorAgent: false,
      actorInvokerOverrides: { qaLabRuntime: async () => undefined, codexPhysical: async () => ({
        exitCode: 0, stdout: "FRESH RUN\njobId=real-job\nstepsExpected=1\nstepsExecuted=1\nfunctionalExecution=true\ncausalOutcomeObserved=true",
        stderr: "", timedOut: false, spawnedCommand: "mock",
      }) },
    });
    assert.equal(result.iterations.at(-1)?.evidenceKind, "CODEX_PHYSICAL_RESULT");
    assert.equal(result.iterations.at(-1)?.codexPhysicalResult?.freshRunId, "real-job");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("physical run id reused from a prior task is rejected as fresh evidence and retried", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-reused-job-id-"));
  const reusedRunId = "run-id-already-recorded";
  try {
    const priorDir = path.join(root, ".artifacts", "orchestrator", "prior-task");
    fs.mkdirSync(priorDir, { recursive: true });
    fs.writeFileSync(path.join(priorDir, "state.json"), JSON.stringify({
      task: { taskId: "prior-task" }, status: "RUNNING", physicalGreens: [], iterations: [{
        iteration: 1,
        codexPhysicalResult: { actor: "CODEX_PHYSICAL", taskId: "prior-task", iteration: 1, freshRunId: reusedRunId },
      }],
    }), "utf8");
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/" }));
    const claudeResult = {
      actor: "CLAUDE" as const, taskId: initial.task.taskId, iteration: 1,
      firstLoss: { file: "src/example.ts", function: "inspect", condition: "needed", reason: "first" },
      fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
      tests: { passed: 1, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 },
      result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, humanGate: false, externalBlocker: false },
    };
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CLAUDE_RESULT" as const, claudeResult, decision: decide(initial, claudeResult) }] };
    const result = await runOneIteration(root, state, {
      dryRun: false, useCodexOrchestratorAgent: false,
      actorInvokerOverrides: { qaLabRuntime: async () => undefined, codexPhysical: async () => ({
        exitCode: 0, stdout: `FRESH RUN\njobId=${reusedRunId}\nstepsExpected=1\nstepsExecuted=1\nfunctionalExecution=true\ncausalOutcomeObserved=true`,
        stderr: "", timedOut: false, spawnedCommand: "mock",
      }) },
    });
    const iteration = result.iterations.at(-1)!;
    assert.equal(iteration.codexPhysicalResult?.physical.fresh, true, "preserve what the verifier reported");
    assert.equal(iteration.codexPhysicalResult?.physical.freshRunIdReused, true);
    assert.equal(iteration.decision.decision, "CALL_CODEX_PHYSICAL");
    assert.match(iteration.decision.earliestFirstLoss?.boundary ?? "", /run identity/);
    assert.equal(result.status, "RUNNING");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fresh physical first-loss with zero executed steps routes to Claude and carries evidence forward", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-first-loss-handoff-"));
  try {
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/" }));
    const claudeResult = {
      actor: "CLAUDE" as const, taskId: initial.task.taskId, iteration: 1,
      firstLoss: { file: "src/example.ts", function: "inspect", condition: "needed", reason: "first" },
      fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
      tests: { passed: 1, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 },
      result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, humanGate: false, externalBlocker: false },
    };
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CLAUDE_RESULT" as const, claudeResult, decision: decide(initial, claudeResult) }] };
    const physical = await runOneIteration(root, state, {
      dryRun: false, useCodexOrchestratorAgent: false,
      actorInvokerOverrides: { qaLabRuntime: async () => undefined, codexPhysical: async () => ({
        exitCode: 0,
        stdout: "FRESH RUN\njobId=real-run\nstepsExpected=1\nstepsExecuted=0\nfunctionalExecution=false\ncausalOutcomeObserved=false\nFIRST LOSS\nfile=src/recorder-control.ts\ncondition=control request rejected\nreason=source boundary does not expose the required operation\nexternalBlocker=false",
        stderr: "", timedOut: false, spawnedCommand: "mock",
      }) },
    });
    const physicalIteration = physical.iterations.at(-1)!;
    assert.equal(physicalIteration.evidenceKind, "CODEX_PHYSICAL_RESULT");
    assert.equal(physicalIteration.codexPhysicalResult?.physical.stepsExecuted, 0);
    assert.equal(physicalIteration.decision.decision, "CALL_CLAUDE");
    assert.equal(physical.status, "RUNNING");

    const builderTurn = await runOneIteration(root, physical, { dryRun: true });
    const promptPath = builderTurn.iterations.at(-1)?.generatedPromptPath;
    assert.equal(builderTurn.iterations.at(-1)?.decision.decision, "CALL_CLAUDE");
    assert.ok(promptPath);
    const prompt = fs.readFileSync(promptPath!, "utf8");
    assert.match(prompt, /freshRunId=real-run/);
    assert.match(prompt, /physicalFirstLoss=src\/recorder-control\.ts/);
    assert.match(prompt, /physicalEvidence=control request rejected/);
    assert.match(prompt, /physicalReason=source boundary does not expose the required operation/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fresh physical external blocker remains terminal even with a first-loss and zero steps", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-external-first-loss-"));
  try {
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/" }));
    const claudeResult = {
      actor: "CLAUDE" as const, taskId: initial.task.taskId, iteration: 1,
      firstLoss: { file: "src/example.ts", function: "inspect", condition: "needed", reason: "first" },
      fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
      tests: { passed: 1, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 },
      result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, humanGate: false, externalBlocker: false },
    };
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CLAUDE_RESULT" as const, claudeResult, decision: decide(initial, claudeResult) }] };
    const result = await runOneIteration(root, state, {
      dryRun: false, useCodexOrchestratorAgent: false,
      actorInvokerOverrides: { qaLabRuntime: async () => undefined, codexPhysical: async () => ({
        exitCode: 0,
        stdout: "FRESH RUN\njobId=external-run\nstepsExpected=1\nstepsExecuted=0\nfunctionalExecution=false\ncausalOutcomeObserved=false\nFIRST LOSS\nfile=external dependency\ncondition=service unavailable\nreason=required external service unavailable\nexternalBlocker=true",
        stderr: "", timedOut: false, spawnedCommand: "mock",
      }) },
    });
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.equal(result.iterations.at(-1)?.codexPhysicalResult?.externalBlocker, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("physical verifier sends the multiline contract through UTF-8 stdin, not native argv", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "codex-qa-verify.ps1"), "utf8");
  assert.match(script, /\$OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(script, /\$guardrails\s*\|\s*& codex exec[\s\S]*?--skip-git-repo-check\s*`\s*-o\s+\$outFile\s*`\s*-/);
  assert.doesNotMatch(script, /--skip-git-repo-check\s*`\s*-o\s+\$outFile\s*`\s*\$guardrails/);
  const recordingOutputFilter = script.split(/\r?\n/).find((line) => line.includes("automations") && line.includes("recordings"));
  assert.ok(recordingOutputFilter?.includes("^\\?\\?"));
  assert.ok(recordingOutputFilter?.includes("recordings[\\\\/]"));
});

test("Claude Builder receives the explicitly configured source workspace", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-builder-workspace-"));
  const builderRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-builder-external-workspace-"));
  let observedWorkspace: string | undefined;
  try {
    const initial = initState(task({ builderWorkspaceRoot: builderRoot }));
    const result = await runOneIteration(root, initial, {
      dryRun: false, useCodexOrchestratorAgent: false,
      actorInvokerOverrides: { claudeBuilder: async (_repoRoot, _taskId, prompt, opts) => {
        observedWorkspace = opts?.workingDirectory;
        assert.ok(prompt.includes(builderRoot));
        return { available: false, reason: "test stop after workspace dispatch" };
      } },
    });
    assert.equal(observedWorkspace, builderRoot);
    assert.equal(result.status, "EXTERNAL_BLOCKER");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(builderRoot, { recursive: true, force: true });
  }
});

test("physical source-change HUMAN_GATE takes precedence over missing step execution and preserves result", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-human-gate-priority-"));
  try {
    const initial = initState(task({ steps: ["action A"], qaLabBaseUrl: "http://qa-lab.test", runtimeUrl: "https://target.test/" }));
    const claudeResult = {
      actor: "CLAUDE" as const, taskId: initial.task.taskId, iteration: 1,
      firstLoss: { file: "src/example.ts", function: "inspect", condition: "needed", reason: "first" },
      fix: { filesChanged: [], behaviorChanged: false, sharedCoreReused: true, hardcoded: false, positionUsed: false, sleepAdded: false },
      tests: { passed: 1, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0 },
      result: { readyForPhysicalReplay: true, successCriteriaSatisfied: [], successCriteriaOpen: initial.task.successCriteria, humanGate: false, externalBlocker: false },
    };
    const state = { ...initial, iterations: [{ iteration: 1, at: "fixture", evidenceKind: "CLAUDE_RESULT" as const, claudeResult, decision: decide(initial, claudeResult) }] };
    const result = await runOneIteration(root, state, {
      dryRun: false, useCodexOrchestratorAgent: false,
      actorInvokerOverrides: { qaLabRuntime: async () => undefined, codexPhysical: async () => ({
        exitCode: 2,
        stdout: "FRESH RUN\njobId=fresh-job\nREPO_CHANGE_GUARD status=HUMAN_GATE\nstepsExpected=1\nstepsExecuted=0\nhumanGate=true",
        stderr: "", timedOut: false, spawnedCommand: "mock",
      }) },
    });
    assert.equal(result.status, "HUMAN_GATE");
    assert.equal(result.iterations.at(-1)?.evidenceKind, "CODEX_PHYSICAL_RESULT");
    assert.equal(result.iterations.at(-1)?.codexPhysicalResult?.sourceChanged, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("9: Claude effort is always medium when the agent proposes no escalation", () => {
  const state = initState(task());
  const decision = validateAgentDecision(state, undefined, { decision: "CALL_CLAUDE", successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria, nextActor: "CLAUDE_BUILDER" }, "decision=CALL_CLAUDE");
  assert.equal(decision.claudeEffort, "medium");
  assert.equal(decision.claudeEffortReason, undefined);
});

test("10: medium remains the fixed Claude Builder effort", () => {
  const state = initState(task());
  const decision = validateAgentDecision(state, undefined, {
    decision: "CALL_CLAUDE",
    successCriteriaSatisfied: [],
    successCriteriaOpen: task().successCriteria,
    nextActor: "CLAUDE_BUILDER",
    claudeEffort: "medium",
    claudeEffortReason: "evidencia contradictoria entre Claude y Codex Physical en la ultima iteracion",
  }, "decision=CALL_CLAUDE");
  assert.equal(decision.claudeEffort, "medium");
  assert.equal(decision.claudeEffortReason, undefined);
});

test("11: medium does not require escalation metadata", () => {
  const state = initState(task());
  const decision = validateAgentDecision(state, undefined, {
    decision: "CALL_CLAUDE",
    successCriteriaSatisfied: [],
    successCriteriaOpen: task().successCriteria,
    nextActor: "CLAUDE_BUILDER",
    claudeEffort: "medium",
    claudeEffortReason: "porque si",
  }, "decision=CALL_CLAUDE");
  assert.equal(decision.claudeEffort, "medium");
});

test("11b: unsupported effort claims cannot change the fixed medium policy", () => {
  const state = initState(task());
  const decision = validateAgentDecision(state, undefined, {
    decision: "CALL_CLAUDE",
    successCriteriaSatisfied: [],
    successCriteriaOpen: task().successCriteria,
    nextActor: "CLAUDE_BUILDER",
    claudeEffort: "high",
    claudeEffortReason: "riesgo real de romper un PHYSICAL GREEN existente y bien documentado",
  }, "decision=CALL_CLAUDE");
  assert.equal(decision.claudeEffort, "medium");
});

test("12: every subsequent Claude Builder decision remains medium", () => {
  const state = initState(task());
  const first = validateAgentDecision(state, undefined, {
    decision: "CALL_CLAUDE", successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria, nextActor: "CLAUDE_BUILDER",
    claudeEffort: "medium", claudeEffortReason: "cambio arquitectonico delicado en el resolver compartido",
  }, "decision=CALL_CLAUDE");
  assert.equal(first.claudeEffort, "medium");
  // next iteration's proposal carries no effort claim; fixed policy is unchanged.
  const second = validateAgentDecision(state, undefined, {
    decision: "CALL_CLAUDE", successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria, nextActor: "CLAUDE_BUILDER",
  }, "decision=CALL_CLAUDE");
  assert.equal(second.claudeEffort, "medium");
});

test("6/7/8: the agent can never unilaterally force SUCCESS/HUMAN_GATE/EXTERNAL_BLOCKER without deterministic() independently agreeing (deterministic guard authority)", () => {
  const state = initState(task());
  for (const stop of ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"] as const) {
    const decision = validateAgentDecision(state, undefined, { decision: stop, successCriteriaSatisfied: [], successCriteriaOpen: task().successCriteria }, "");
    // No evidence exists yet -> deterministic() always says CALL_CLAUDE; an agent proposing any
    // stop reason without matching evidence must be rejected, never trusted on its own claim.
    assert.equal(decision.decision, "CALL_CLAUDE");
  }
});

test("6b: HUMAN_GATE IS honored when a real Codex Physical result (sourceChanged) backs it", () => {
  const state = initState(task());
  const codexResult = {
    actor: "CODEX_PHYSICAL", taskId: "live-t1", iteration: 1, freshRunId: "j1",
    physical: { fresh: true, stepsExpected: 1, stepsExecuted: 1, functionalExecution: true, causalOutcomeObserved: true },
    successCriteriaSatisfied: [], successCriteriaOpen: [], humanGate: false, externalBlocker: false, sourceChanged: true,
  };
  const decision = validateAgentDecision(state, codexResult as any, { decision: "HUMAN_GATE", successCriteriaSatisfied: [], successCriteriaOpen: [] }, "");
  assert.equal(decision.decision, "HUMAN_GATE");
});
