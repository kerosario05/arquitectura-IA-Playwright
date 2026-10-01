import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs } from "../../scripts/qa-lab-orchestrator";
import { buildTaskIntakePrompt, parseTaskIntake } from "./codex-orchestrator-invoker";
import { parseClaudeResult } from "./result-parser";
import { buildFinalTaskSummary, loadActivity, loadHistory, materializeTaskContract, routeChatInput } from "./chat-ui";
import type { OrchestratorState } from "./types";

function historyFixture(iterations: OrchestratorState["iterations"] = []): OrchestratorState {
  return {
    task: { taskId: "legacy-task" } as OrchestratorState["task"],
    iterations,
    status: "RUNNING",
    physicalGreens: [],
    lastFirstLossRepeatCount: 0,
  };
}

function historyIteration(iteration: number): OrchestratorState["iterations"][number] {
  return {
    iteration,
    at: `2026-01-01T00:00:${String(iteration).padStart(2, "0")}Z`,
    evidenceKind: "CODEX_PHYSICAL_RESULT",
    decision: {
      decision: "CALL_CODEX_PHYSICAL",
      nextActor: "CODEX_PHYSICAL",
      actor: "ORCHESTRATOR",
      earliestFirstLoss: { boundary: "capture-attach-boundary" },
    } as OrchestratorState["iterations"][number]["decision"],
  };
}

function withChatFixture(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-chat-history-"));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function currentTerminalFixture(): OrchestratorState {
  const criteria = [
    "Un fresh Codex Physical run demuestra que las acciones conducidas quedan adjuntas a la sesión del recorder y aparecen en la evidencia de captura",
    "Un fix queda validado físicamente o se documenta un bloqueo externo real con evidencia fresca",
  ];
  const firstLoss = {
    boundary: "OPEN capture-attach-boundary: la conducción física usa una página independiente",
    evidence: "stale physical run rejected",
    reason: "physical.fresh=false never satisfies a physical criterion",
  };
  return {
    task: { taskId: "task-20260926214742", objective: "Resolver capture-attach-boundary", successCriteria: criteria, physicalValidationRequired: true, currentFrontier: firstLoss.boundary, physicalGreens: [], allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"] },
    iterations: [{
      iteration: 4, at: "2026-09-26T21:55:10.861Z", evidenceKind: "NONE",
      codexPhysicalResult: { actor: "CODEX_PHYSICAL", taskId: "task-20260926214742", iteration: 3, freshRunId: "", physical: { fresh: false, stepsExpected: 0, stepsExecuted: 0, functionalExecution: false, causalOutcomeObserved: false }, successCriteriaSatisfied: [], successCriteriaOpen: criteria, humanGate: false, externalBlocker: false, sourceChanged: false },
      decision: { actor: "ORCHESTRATOR", taskId: "task-20260926214742", iteration: 4, decision: "HUMAN_GATE", physicalGreensPreserved: [], successCriteriaSatisfied: [], successCriteriaOpen: criteria, earliestFirstLoss: firstLoss, stopReasonDetail: "NO_PROGRESS_WITH_SAME_EVIDENCE: equivalent stale physical result repeated 3 times (limit=3)." },
    }],
    status: "HUMAN_GATE", physicalGreens: [], lastFirstLossRepeatCount: 2,
  };
}

test("final summary is deterministic, terminal-only, and does not claim stale physical PASS", () => {
  const fixture = currentTerminalFixture();
  assert.equal(fixture.status, "HUMAN_GATE");
  const summary = buildFinalTaskSummary(fixture);
  assert.ok(summary);
  assert.match(summary, /FINAL STATUS: HUMAN_GATE/);
  assert.match(summary, /NO VALIDADO FÍSICAMENTE/);
  assert.match(summary, /fresh=false/);
  assert.match(summary, /NO_PROGRESS_WITH_SAME_EVIDENCE/);
  assert.match(summary, /Obtener una corrida física fresh antes de continuar/);
  assert.match(summary, /☐ Un fresh Codex Physical run/);
  assert.doesNotMatch(summary.match(/CONCLUSIÓN:.*$/m)?.[0] ?? "", /physical PASS|fix validado|todo correcto/i);
  assert.equal(buildFinalTaskSummary({ ...fixture, status: "RUNNING" }), undefined);

  const success = structuredClone(fixture);
  success.status = "SUCCESS";
  success.iterations.at(-1)!.decision.decision = "SUCCESS";
  success.iterations.at(-1)!.decision.successCriteriaSatisfied = [...success.task.successCriteria];
  success.iterations.at(-1)!.decision.successCriteriaOpen = [];
  assert.match(buildFinalTaskSummary(success) ?? "", /Validación completada\.[\s\S]*No se requiere acción adicional/);

  const external = structuredClone(fixture);
  external.status = "EXTERNAL_BLOCKER";
  external.iterations.at(-1)!.decision.decision = "EXTERNAL_BLOCKER";
  external.iterations.at(-1)!.decision.stopReasonDetail = "dependency endpoint unavailable";
  assert.match(buildFinalTaskSummary(external) ?? "", /EXTERNAL_BLOCKER[\s\S]*Resolver la dependencia externa indicada: dependency endpoint unavailable/);
});

test("final summary reports the effective Codex Builder fallback and /summary routes locally", () => {
  const fixture = structuredClone(currentTerminalFixture());
  const builderIteration = structuredClone(fixture.iterations[0]);
  builderIteration.claudeResult = parseClaudeResult("actor=CLAUDE\nhumanGate=false\nsourceChanged=false", fixture.task.taskId, 1);
  builderIteration.claudeResult.actor = "CODEX_BUILDER";
  builderIteration.claudeResult.result.sourceChanged = undefined;
  builderIteration.effectiveActor = "CODEX_BUILDER";
  builderIteration.requestedActor = "CLAUDE_BUILDER";
  fixture.iterations.unshift(builderIteration);
  const summary = buildFinalTaskSummary(fixture) ?? "";
  assert.match(summary, /CODEX_BUILDER \(solicitado: CLAUDE_BUILDER\)/);
  assert.match(summary, /humanGate=false; sourceChanged=not reported/);
  assert.deepEqual(routeChatInput("/summary"), { kind: "command", command: "/summary" });

  const exactGate = structuredClone(fixture);
  exactGate.iterations[0].claudeResult = parseClaudeResult("actor=CLAUDE\nhumanGate=false\nsourceChanged=true", fixture.task.taskId, 1);
  assert.match(buildFinalTaskSummary(exactGate) ?? "", /humanGate=false; sourceChanged=true/);
  exactGate.iterations[0].claudeResult = parseClaudeResult("actor=CLAUDE\nhumanGate=true\nsourceChanged=false", fixture.task.taskId, 1);
  assert.match(buildFinalTaskSummary(exactGate) ?? "", /humanGate=true; sourceChanged=false/);
});

test("chat history prefers modern events and never duplicates state iterations", () => {
  withChatFixture((root) => {
    const state = historyFixture([historyIteration(6)]);
    const eventDir = path.join(root, ".artifacts", "orchestrator", state.task.taskId);
    fs.mkdirSync(eventDir, { recursive: true });
    fs.writeFileSync(path.join(eventDir, "events.jsonl"), `${JSON.stringify({
      timestamp: "2026-01-01T00:00:06Z", taskId: state.task.taskId, iteration: 6,
      actor: "CODEX_PHYSICAL", type: "started", summary: "modern event",
    })}\n`);
    assert.deepEqual(loadHistory(root, state), ["Iteration 6\nCODEX_PHYSICAL started · modern event"]);
    assert.deepEqual(loadActivity(root, state), ["CODEX_PHYSICAL started · modern event"]);
  });
});

test("legacy history and activity derive locally without writing events or mutating state", () => {
  withChatFixture((root) => {
    const state = historyFixture([historyIteration(6), historyIteration(7)]);
    const stateDir = path.join(root, ".artifacts", "orchestrator", state.task.taskId);
    fs.mkdirSync(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, "state.json");
    const originalState = JSON.stringify(state);
    fs.writeFileSync(stateFile, originalState);
    const history = loadHistory(root, state);
    const activity = loadActivity(root, state);
    assert.equal(history.length, 2);
    assert.match(history[0], /Iteration 6\nCODEX_PHYSICAL_RESULT\n→ CALL_CODEX_PHYSICAL\n→ CODEX_PHYSICAL\nFirst loss: capture-attach-boundary/);
    assert.match(activity.join("\n"), /Iteration 7/);
    assert.equal(fs.existsSync(path.join(stateDir, "events.jsonl")), false);
    assert.equal(fs.readFileSync(stateFile, "utf8"), originalState);
  });
});

test("empty or missing event files fall back to iterations, and empty iterations are valid", () => {
  withChatFixture((root) => {
    const state = historyFixture([historyIteration(8)]);
    const eventDir = path.join(root, ".artifacts", "orchestrator", state.task.taskId);
    fs.mkdirSync(eventDir, { recursive: true });
    const eventsFile = path.join(eventDir, "events.jsonl");
    fs.writeFileSync(eventsFile, "\n");
    assert.match(loadHistory(root, state)[0], /Iteration 8/);
    fs.rmSync(eventsFile);
    assert.match(loadActivity(root, state)[0], /Iteration 8/);
    assert.deepEqual(loadHistory(root, historyFixture()), []);
    assert.deepEqual(loadActivity(root, historyFixture()), []);
  });
});

test("chat routes slash inputs locally and only plain text to intake", () => {
  assert.deepEqual(routeChatInput("/tasks"), { kind: "command", command: "/tasks" });
  for (const input of ["/tasj", "/task"]) {
    assert.deepEqual(routeChatInput(input), { kind: "unknown", suggestion: "/tasks" });
  }
  assert.deepEqual(routeChatInput("/whatever"), { kind: "unknown" });
  assert.deepEqual(routeChatInput("QA Lab no captura un control"), { kind: "intake" });
  assert.deepEqual(routeChatInput("/open capture-visa-authority"), {
    kind: "command", command: "/open", argument: "capture-visa-authority",
  });
  assert.deepEqual(routeChatInput("/open"), { kind: "command", command: "/open" });
});

test("chat mode is additive and keeps the existing live defaults", () => {
  const args = parseArgs(["--chat"]);
  assert.equal(args.chat, true);
  assert.equal(args.useCodexOrchestratorAgent, true);
  assert.equal(args.dryRun, false);
});

test("task intake parses a valid generic TaskContract draft", () => {
  const result = parseTaskIntake([
    "objective=Validate a recording boundary",
    "physicalValidationRequired=true",
    "currentFrontier=recording capture boundary",
    "successCriteria=[fresh recording exists, functional action is captured]",
    "steps=[Open the supplied screen, perform the documented action]",
    "qaLabBaseUrl=http://localhost:3001",
    "projectSlug=qa-project",
    "runtimeUrl=https://example.test/",
    "missingData=[]",
  ].join("\n"));
  assert.deepEqual(result.missingData, []);
  assert.deepEqual(result.draft, {
    objective: "Validate a recording boundary",
    physicalValidationRequired: true,
    currentFrontier: "recording capture boundary",
    successCriteria: ["fresh recording exists", "functional action is captured"],
    steps: ["Open the supplied screen", "perform the documented action"],
    qaLabBaseUrl: "http://localhost:3001",
    projectSlug: "qa-project",
    runtimeUrl: "https://example.test/",
  });
  assert.equal(JSON.parse(JSON.stringify(result.draft)).runtimeUrl, "https://example.test/");
  const withoutRuntimeUrl = parseTaskIntake([
    "objective=Validate a recording boundary", "physicalValidationRequired=true", "currentFrontier=recording capture boundary",
    "successCriteria=[fresh recording exists]", "steps=[Open the supplied screen]", "qaLabBaseUrl=http://localhost:3001", "missingData=[]",
  ].join("\n"));
  assert.equal(withoutRuntimeUrl.draft?.runtimeUrl, undefined);
  assert.equal(withoutRuntimeUrl.draft?.projectSlug, undefined);
  const sentinelBoundary = parseTaskIntake([
    "objective=Repair recorded spec generation", "physicalValidationRequired=false", "currentFrontier=spec generation",
    "successCriteria=[spec is promoted]", "steps=[]", "qaLabBaseUrl=.", "projectSlug=roke", "runtimeUrl=.", "missingData=[]",
  ].join("\n"));
  assert.equal(sentinelBoundary.draft?.qaLabBaseUrl, undefined);
  assert.equal(sentinelBoundary.draft?.runtimeUrl, undefined);
  assert.equal(sentinelBoundary.draft?.physicalValidationRequired, false);
  const materialized = materializeTaskContract("intake-runtime-url", result.draft!);
  assert.equal(JSON.parse(JSON.stringify(materialized)).runtimeUrl, "https://example.test/");
});

test("task intake prompt uses the existing Luna/Medium read-only role", () => {
  const prompt = buildTaskIntakePrompt("A recording action is missing", "AGENTS.md context");
  assert.match(prompt, /CODEX ORCHESTRATOR/);
  assert.match(prompt, /Fuente READ-ONLY/);
  assert.match(prompt, /No inventes URLs/);
  assert.match(prompt, /Copia únicamente los pasos físicos ordenados/);
  assert.match(prompt, /projectSlug y runtimeUrl cuando estén explícitos en la solicitud\/configuración del proyecto/);
  assert.match(prompt, /projectSlug/);
});
