import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildClaudePrompt, buildCodexPhysicalPrompt, findForbiddenHints } from "./prompt-builder";
import { parseCodexPhysicalResult } from "./result-parser";
import type { OrchestratorDecision, TaskContract } from "./types";

function task(): TaskContract {
  return {
    taskId: "capture-visa-authority",
    objective: "La accion grabada debe conservar autoridad ejecutable y reproducirse.",
    successCriteria: ["fresh recording created", "webSteps materialized"],
    physicalValidationRequired: true,
    currentFrontier: "capture-attach-boundary",
    physicalGreens: ["gate1-css-scope-fallback", "gate2-shadow-bridge-technicalEvidence"],
    allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"],
  };
}

function decision(): OrchestratorDecision {
  return {
    actor: "ORCHESTRATOR",
    taskId: "capture-visa-authority",
    iteration: 3,
    decision: "CALL_CLAUDE",
    physicalGreensPreserved: ["gate1-css-scope-fallback", "gate2-shadow-bridge-technicalEvidence"],
    earliestFirstLoss: { boundary: "src/discovery/field-scoped-live-discovery.ts", evidence: "trace.json actionCount=0", reason: "CaptureEngine V2 never attached to the driven page" },
    successCriteriaSatisfied: [],
    successCriteriaOpen: ["fresh recording created", "webSteps materialized"],
  };
}

test("CASE 10: generated Claude prompt contains every required section", () => {
  const prompt = buildClaudePrompt(task(), decision(), process.cwd());
  assert.ok(prompt.includes('"required":["actor","file","function","condition","reason","filesChanged"'));
  assert.match(prompt, /objeto JSON válido conforme al schema compartido/);
  for (const marker of [
    "$qa-lab-low-token-debug",
    "/ponytail:ponytail full",
    "/caveman:caveman full",
    "REPO AUTORITATIVO:",
    "TAREA UNICA:",
    "EVIDENCIA FISICA:",
    "FIRST LOSS:",
    "NO REABRIR:",
    "OBJETIVO:",
    "INVARIANTES / ALCANCE / PROHIBIDO:",
    "TESTS FOCALES:",
    "PHYSICAL GATE:",
    "SALIDA",
    "STOP.",
  ]) {
    assert.ok(prompt.includes(marker), `prompt missing required section: ${marker}`);
  }
  // exactly one first-loss surfaced, never a bundle of several
  const firstLossOccurrences = prompt.match(/"file":\{"type":"string"\}/g);
  assert.equal(firstLossOccurrences?.length, 1);
  // physical GREEN boundaries preserved verbatim
  assert.ok(prompt.includes("gate1-css-scope-fallback"));
  assert.ok(prompt.includes("gate2-shadow-bridge-technicalEvidence"));
  assert.match(prompt, /CODEX_PHYSICAL delegado por el Orchestrator/);
  assert.match(prompt, /Falta de logs\/artifacts diagnósticos NO es external blocker/);
});

test("CASE 11: generated prompt never injects a forbidden authority pattern", () => {
  const prompt = buildClaudePrompt(task(), decision(), process.cwd());
  assert.deepEqual(findForbiddenHints(prompt), []);
});

test("forbidden-pattern examples in historical chat do not abort a fresh Builder handoff", () => {
  const prompt = buildClaudePrompt({
    ...task(),
    threadContext: "An earlier message quoted .first() and waitForTimeout(1000) only as forbidden examples.",
  }, decision(), process.cwd());
  assert.deepEqual(findForbiddenHints(prompt), []);
});

test("chat history is passed as context and never represented as fresh physical evidence", () => {
  const prompt = buildClaudePrompt({ ...task(), threadContext: "USUARIO · revisar el resultado anterior" }, decision(), process.cwd());
  assert.match(prompt, /CONTEXTO HISTÓRICO DEL CHAT \(solo contexto; no es evidencia nueva ni autoridad física\)/);
  assert.match(prompt, /USUARIO · revisar el resultado anterior/);
  assert.match(prompt, /EVIDENCIA FISICA:/);
  assert.doesNotMatch(prompt, /fresh=true/);
});

test("findForbiddenHints flags an actually-injected forbidden pattern", () => {
  assert.deepEqual(findForbiddenHints("click(nth(3))"), ["\\bnth\\("]);
  assert.deepEqual(findForbiddenHints("await page.waitForTimeout(5000)"), ["\\bwaitForTimeout\\("]);
});

test("physical prompt preserves the ordered task contract and recorder-owned QA Lab boundary", () => {
  const physicalTask = { ...task(), successCriteria: ["candidateTargets and stable identifier available"], steps: ["action A", "action B"], qaLabBaseUrl: "http://localhost:3001", projectSlug: "qa-project", runtimeUrl: "https://example.test/" };
  const prompt = buildCodexPhysicalPrompt(physicalTask, { ...decision(), decision: "CALL_CODEX_PHYSICAL" }, process.cwd());
  assert.ok(prompt.includes('Pasos físicos en orden exacto (JSON): ["action A","action B"]'));
  assert.ok(prompt.includes("QA Lab base URL: http://localhost:3001"));
  assert.ok(prompt.includes("QA Lab projectSlug: qa-project"));
  assert.ok(prompt.includes("Runtime URL: https://example.test/"));
  assert.match(prompt, /pasa el projectSlug explícito a POST \/api\/recordings\/start/);
  assert.match(prompt, /página propiedad del WebSessionRecorder/);
  assert.match(prompt, /API de control soportada/);
  assert.match(prompt, /no lo invoques de nuevo ni arranques otra instancia de Codex CLI/);
  assert.match(prompt, /POST \/api\/recordings\/:recordingId\/derive/);
  assert.match(prompt, /GET \/api\/recordings\/:recordingId\/scenarios/);
  assert.match(prompt, /ni altera stepsExpected\/stepsExecuted/);
});

test("fresh recording artifact paths are handed to Builder from the verified project and run id", () => {
  const physicalTask: TaskContract = {
    ...task(),
    projectSlug: "qa-project",
    qaLabReference: { kind: "recording", id: "historical-recording", projectSlug: "qa-project" },
  };
  const prompt = buildClaudePrompt(physicalTask, decision(), process.cwd(), {
    actor: "CODEX_PHYSICAL",
    taskId: physicalTask.taskId,
    iteration: 2,
    freshRunId: "fresh-recording-123",
    recordingId: "fresh-recording-123",
    physical: { fresh: true, stepsExpected: 15, stepsExecuted: 15, functionalExecution: true, causalOutcomeObserved: false },
    successCriteriaSatisfied: [], successCriteriaOpen: [], humanGate: false, externalBlocker: false, sourceChanged: false,
  });
  assert.ok(prompt.includes(path.join(process.cwd(), "automations", "apps", "qa-project", "recordings", "fresh-recording-123", "trace.json")));
  assert.ok(prompt.includes("verifica existencia antes de leer"));
  assert.ok(prompt.includes("historical-recording"), "historical and fresh recording ids remain distinguishable");
});

test("Codex Physical result parser preserves job id and reported step counts", () => {
  const result = parseCodexPhysicalResult([
    "FRESH RUN", "jobId=recording-run-123", "stepsExpected=2", "stepsExecuted=2",
    "functionalExecution=true", "causalOutcomeObserved=true", "FIRST LOSS", "file=", "reason=",
  ].join("\n"), "task", 1);
  assert.equal(result.freshRunId, "recording-run-123");
  assert.equal(result.physical.fresh, true);
  assert.equal(result.physical.stepsExpected, 2);
  assert.equal(result.physical.stepsExecuted, 2);
});

test("skill/plugin token compression: headers present, full skill rule text never repeated, checkpoint referenced, no raw logs, first-loss evidence still present", () => {
  const prompt = buildClaudePrompt(task(), decision(), process.cwd());
  assert.ok(prompt.startsWith("$qa-lab-low-token-debug\n/ponytail:ponytail full\n/caveman:caveman full"));
  // the skill's own full rule text (context budget bullets, evidence hierarchy, etc.) is never
  // duplicated inline -- only a one-line reference to it.
  assert.ok(!prompt.includes("Context budget"));
  assert.ok(!prompt.includes("Evidence hierarchy"));
  // checkpoint-first referenced, not the project's full history
  assert.ok(prompt.includes("CLAUDE.md, AGENTS.md, docs/ai/00-current-state.md"));
  // no raw log dump -- decisive evidence only
  assert.ok(!prompt.includes("[scenario-preview] stdout:"));
  assert.ok(prompt.includes("trace.json actionCount=0"));
  // still exactly one first-loss
  assert.equal(prompt.match(/^file=/m)?.length, 1);
});

test("requiredSkills defaults to the QA Lab trio when the decision carries none", () => {
  const d = decision();
  assert.equal(d.requiredSkills, undefined);
  const prompt = buildClaudePrompt(task(), d, process.cwd());
  assert.ok(prompt.includes("$qa-lab-low-token-debug"));
  assert.ok(prompt.includes("/ponytail:ponytail full"));
  assert.ok(prompt.includes("/caveman:caveman full"));
});
