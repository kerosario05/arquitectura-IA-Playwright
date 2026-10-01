import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCodexBuilderPrompt, buildCodexBuilderRunnerInput, claudeBuilderArgs, codexBuilderArgs, codexPhysicalArgs, classifyClaudeQuotaFailure, type ActorSpawnResult } from "./actor-invoker";
import { CODEX_ORCHESTRATOR_EFFORT, CODEX_ORCHESTRATOR_MODEL, codexOrchestratorArgs } from "./codex-orchestrator-invoker";
import { runOneIteration } from "./orchestrator-runner";
import { initState, decide } from "./state-machine";
import type { TaskContract } from "./types";

const task: TaskContract = {
  taskId: "builder-fallback-test",
  objective: "Repair one bounded QA Lab issue",
  successCriteria: ["focused fix recorded", "physical verification complete"],
  physicalValidationRequired: true,
  currentFrontier: "the evidenced first-loss boundary",
  physicalGreens: ["green-boundary"],
  allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"],
};

function processResult(stdout: string, overrides: Partial<ActorSpawnResult> = {}): ActorSpawnResult {
  return { exitCode: 0, stdout, stderr: "", timedOut: false, spawnedCommand: "mock", ...overrides };
}

function builderOutput(actor: "CLAUDE" | "CODEX_BUILDER", humanGate = false, sourceChanged = false): string {
  return [
    `actor=${actor}`, `taskId=${task.taskId}`, "iteration=1",
    "file=src/example.ts", "function=run", "condition=missing", "reason=first loss",
    "filesChanged=[src/example.ts]", "behaviorChanged=true", "sharedCoreReused=true", "hardcoded=false", "positionUsed=false", "sleepAdded=false",
    "passed=2", "failed=0", "newTypeErrors=0", "preExistingTypeErrors=523",
    "readyForPhysicalReplay=true", "successCriteriaSatisfied=[focused fix recorded]", "successCriteriaOpen=[physical verification complete]", `humanGate=${humanGate}`, `sourceChanged=${sourceChanged}`, "externalBlocker=false",
  ].join("\n");
}

function builderJson(actor: "CLAUDE" | "CODEX_BUILDER"): Record<string, unknown> {
  return {
    actor, file: "src/example.ts", function: "run", condition: "missing", reason: "first loss",
    filesChanged: ["src/example.ts"], behaviorChanged: true, sharedCoreReused: true, hardcoded: false,
    positionUsed: false, sleepAdded: false, passed: 2, failed: 0, newTypeErrors: 0, preExistingTypeErrors: 0,
    readyForPhysicalReplay: true, successCriteriaSatisfied: ["focused fix recorded"],
    successCriteriaOpen: ["physical verification complete"], humanGate: false, sourceChanged: false, externalBlocker: false,
  };
}

test("Claude CLI uses the locally supported native JSON-schema output contract", () => {
  const args = claudeBuilderArgs(["--permission-mode", "bypassPermissions", "--bare"], "sonnet", "medium");
  assert.deepEqual(args.slice(0, 3), ["--permission-mode", "bypassPermissions", "--bare"]);
  assert.ok(args.includes("--json-schema"));
  assert.ok(args.includes("--output-format") && args[args.indexOf("--output-format") + 1] === "json");
  const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]);
  assert.ok(schema.required.includes("filesChanged"));
  assert.ok(schema.required.includes("passed"));
  assert.ok(schema.required.includes("readyForPhysicalReplay"));
  assert.deepEqual(schema, JSON.parse(args[args.indexOf("--json-schema") + 1]));
});

test("strict parser accepts native Claude JSON result envelope and rejects missing or wrong actor", async () => {
  const { hasBuilderResultContract, parseClaudeResult } = await import("./result-parser");
  const valid = JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(builderJson("CLAUDE")) });
  assert.equal(hasBuilderResultContract(valid, "CLAUDE"), true);
  assert.equal(parseClaudeResult(valid, task.taskId, 4).fix.filesChanged[0], "src/example.ts");
  const missing = builderJson("CLAUDE");
  delete missing.readyForPhysicalReplay;
  assert.equal(hasBuilderResultContract(JSON.stringify(missing), "CLAUDE"), false);
  assert.match((await import("./result-parser")).getBuilderResultContractErrors(JSON.stringify(missing), "CLAUDE").join(";"), /missing required field readyForPhysicalReplay/);
  assert.equal(hasBuilderResultContract(JSON.stringify(builderJson("CODEX_BUILDER")), "CLAUDE"), false);
});

test("valid sourceChanged Claude JSON is persisted and routes to fresh physical; explicit humanGate still wins", async () => {
  const output = JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify({ ...builderJson("CLAUDE"), sourceChanged: true }) });
  const result = await runWith(processResult(output), async () => { throw new Error("valid Claude output must not trigger fallback"); });
  const record = result.updated.iterations.at(-1)!;
  assert.equal(result.fallbackCalls, 0);
  assert.equal(result.updated.status, "RUNNING");
  assert.equal(record.evidenceKind, "CLAUDE_RESULT");
  assert.equal(record.claudeResult?.result.sourceChanged, true);
  assert.equal(decide(result.updated, record.claudeResult).decision, "CALL_CODEX_PHYSICAL");

  const humanGateOutput = JSON.stringify({ type: "result", result: JSON.stringify({ ...builderJson("CLAUDE"), humanGate: true }) });
  const gated = await runWith(processResult(humanGateOutput), async () => { throw new Error("HUMAN_GATE must prevent fallback"); });
  assert.equal(gated.updated.status, "RUNNING");
  assert.equal(gated.fallbackCalls, 0);
});

async function runWith(primary: ActorSpawnResult, fallback: (prompt: string) => Promise<any>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-orchestrator-builder-"));
  const state = initState(task);
  let claudeOptions: { model?: string; effort?: "low" | "medium" } | undefined;
  let claudeCalls = 0;
  let fallbackCalls = 0;
  let fallbackPrompt = "";
  const events: Array<{ actor: string; type: string; summary: string; metadata?: Record<string, unknown> }> = [];
  try {
    const updated = await runOneIteration(root, state, {
      dryRun: false,
      useCodexOrchestratorAgent: false,
      onEvent: (event) => events.push({ actor: event.actor, type: event.type, summary: event.summary, metadata: event.metadata }),
      actorInvokerOverrides: {
        claudeBuilder: async (_repo, _taskId, _prompt, options) => { claudeCalls++; claudeOptions = options; return primary; },
        codexBuilder: async (_repo, prompt) => { fallbackCalls++; fallbackPrompt = prompt; return fallback(prompt); },
      },
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, ".artifacts", "orchestrator", task.taskId, "state.json"), "utf8"));
    return { updated, persisted, claudeCalls, fallbackCalls, fallbackPrompt, claudeOptions, events };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("Codex Orchestrator uses gpt-6-luna medium read-only", () => {
  assert.equal(CODEX_ORCHESTRATOR_MODEL, "gpt-6-luna");
  assert.equal(CODEX_ORCHESTRATOR_EFFORT, "medium");
  assert.ok(codexOrchestratorArgs().includes("read-only"));
});

test("Codex Builder fallback is configured for gpt-6-luna medium workspace-write", () => {
  const args = codexBuilderArgs();
  assert.equal(args[1], "gpt-6-luna");
  assert.ok(args.includes("model_reasoning_effort=medium"));
  assert.ok(args.includes("workspace-write"));
});

test("user-selected Codex Builder is invoked as the primary source writer and persisted distinctly", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-orchestrator-selected-builder-"));
  const selectedTask: TaskContract = { ...task, taskId: "selected-codex-builder-test", builderAgent: "CODEX_BUILDER" };
  let claudeCalls = 0;
  let codexCalls = 0;
  const events: Array<{ actor: string; type: string }> = [];
  try {
    const updated = await runOneIteration(root, initState(selectedTask), {
      dryRun: false,
      useCodexOrchestratorAgent: false,
      onEvent: (event) => events.push({ actor: event.actor, type: event.type }),
      actorInvokerOverrides: {
        claudeBuilder: async () => { claudeCalls++; throw new Error("Claude must not run when Codex Builder is selected."); },
        codexBuilder: async (_repo, prompt) => {
          codexCalls++;
          assert.match(prompt, /actor debe identificar al Builder/);
          return { exitCode: 0, stdout: builderOutput("CODEX_BUILDER").replace("sourceChanged=false", "sourceChanged=true"), stderr: "", timedOut: false, durationMs: 5 };
        },
      },
    });
    const iteration = updated.iterations.at(-1)!;
    assert.equal(claudeCalls, 0);
    assert.equal(codexCalls, 1);
    assert.equal(iteration.claudeResult?.actor, "CODEX_BUILDER");
    assert.equal(iteration.requestedActor, "CODEX_BUILDER");
    assert.equal(iteration.effectiveActor, "CODEX_BUILDER");
    assert.equal(iteration.decision.nextActor, "CODEX_BUILDER");
    assert.equal(decide(updated, iteration.claudeResult).decision, "CALL_CODEX_PHYSICAL");
    assert.ok(events.some((event) => event.actor === "CODEX_BUILDER" && event.type === "ACTOR_STARTED"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex Builder receives an explicit source-writing role wrapper", () => {
  const prompt = buildCodexBuilderPrompt("actor=CLAUDE\nfirst-loss boundary\n");
  assert.match(prompt, /ROLE: CODEX_BUILDER/);
  assert.match(prompt, /actor=CODEX_BUILDER/);
});

test("Codex Builder sends the repair packet over stdin instead of Windows argv", () => {
  const input = buildCodexBuilderRunnerInput("C:\\resolved\\codex.cmd", "C:\\repo", "long structured repair packet");
  assert.equal(input.promptAsStdin, true);
  assert.equal(input.prompt, buildCodexBuilderPrompt("long structured repair packet"));
  assert.equal(input.cwd, "C:\\repo");
});

test("Codex Physical uses process-scoped PowerShell ExecutionPolicy Bypass and preserves wrapper arguments", () => {
  const args = codexPhysicalArgs("C:\\repo", "physical prompt", { effort: "medium", mode: "recording" });
  assert.deepEqual(args.slice(0, 5), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join("C:\\repo", "scripts", "codex-qa-verify.ps1")]);
  assert.deepEqual(args.slice(5), ["-Prompt", "physical prompt", "-Effort", "medium", "-Mode", "recording"]);
  assert.ok(!args.some((argument) => /Set-ExecutionPolicy/.test(argument)));
});

test("quota exhaustion invokes exactly one Codex Builder with the same task packet", async () => {
  const primary = processResult("", { exitCode: 1, stderr: "Plan usage limit exceeded" });
  const result = await runWith(primary, async () => ({ exitCode: 0, stdout: builderOutput("CODEX_BUILDER"), stderr: "", timedOut: false, durationMs: 12 }));
  assert.equal(result.claudeCalls, 1);
  assert.equal(result.fallbackCalls, 1);
  assert.equal(result.claudeOptions?.model, "sonnet");
  assert.equal(result.claudeOptions?.effort, "medium");
  assert.match(result.fallbackPrompt, /first-loss boundary/);
  assert.match(result.fallbackPrompt, /green-boundary/);
  assert.match(result.fallbackPrompt, /physical verification complete/);
  assert.match(result.updated.iterations.at(-1)?.generatedPromptPath ?? "", /iteration-1-claude/);
  assert.equal(result.updated.iterations.at(-1)?.claudeResult?.actor, "CODEX_BUILDER");
  assert.equal(result.updated.iterations.at(-1)?.requestedActor, "CLAUDE_BUILDER");
  assert.equal(result.updated.iterations.at(-1)?.effectiveActor, "CODEX_BUILDER");
  assert.equal(result.updated.iterations.at(-1)?.fallbackReason, "usage_limit");
  assert.ok(result.events.some((event) => event.actor === "CODEX_BUILDER" && event.metadata?.effectiveActor === "CODEX_BUILDER" && event.metadata?.fallbackReason === "usage_limit"));
  assert.ok(result.events.some((event) => event.actor === "CODEX_BUILDER" && event.type === "ACTOR_STARTED" && /continuando el trabajo de Builder/.test(event.summary)));
  assert.equal(decide(result.updated, result.updated.iterations.at(-1)?.claudeResult).decision, "CALL_CODEX_PHYSICAL");
});

test("usage and quota variants classify; unknown, timeout, and successful exits do not", () => {
  for (const message of ["usage limit reached", "You've hit your limit", "insufficient_quota", "rate_limit_error", "Too many requests"]) {
    assert.ok(classifyClaudeQuotaFailure(processResult("", { exitCode: 1, stderr: message })));
  }
  assert.equal(classifyClaudeQuotaFailure(processResult("", { exitCode: 1, stderr: "authentication failed" })), undefined);
  assert.equal(classifyClaudeQuotaFailure(processResult("", { exitCode: 1, stderr: "usage limit reached", timedOut: true })), undefined);
  assert.equal(classifyClaudeQuotaFailure(processResult("usage limit reached")), undefined);
});

test("Claude success does not fall back and always receives medium effort", async () => {
  const result = await runWith(processResult(builderOutput("CLAUDE")), async () => { throw new Error("fallback must not run"); });
  assert.equal(result.fallbackCalls, 0);
  assert.equal(result.claudeOptions?.effort, "medium");
  assert.equal(result.updated.iterations.at(-1)?.effectiveActor, "CLAUDE_BUILDER");
  assert.equal(result.updated.iterations.at(-1)?.evidenceKind, "CLAUDE_RESULT");
  assert.equal(result.updated.iterations.at(-1)?.claudeResult?.result.humanGate, false);
  assert.equal(result.updated.iterations.at(-1)?.claudeResult?.result.sourceChanged, false);
  const working = result.events.find((event) => event.actor === "CLAUDE_BUILDER" && event.type === "ACTOR_STARTED");
  assert.match(working?.summary ?? "", /Claude Builder está trabajando en la frontera/);
  assert.ok(result.events.some((event) => event.actor === "CLAUDE_BUILDER" && event.type === "ACTOR_FINISHED"));
});

test("unknown Claude failure fails closed without invoking Codex Builder", async () => {
  const result = await runWith(processResult("", { exitCode: 1, stderr: "authentication/configuration failure" }), async () => { throw new Error("fallback must not run"); });
  assert.equal(result.fallbackCalls, 0);
  assert.equal(result.updated.status, "EXTERNAL_BLOCKER");
});

test("invalid Claude contract persists bounded redacted response and concrete parser error", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-invalid-claude-"));
  const secret = "api_key=sk-abcdefghijk123456";
  const events: Array<{ metadata?: Record<string, unknown> }> = [];
  try {
    const state = initState(task);
    const result = await runOneIteration(root, state, {
      dryRun: false,
      useCodexOrchestratorAgent: false,
      onEvent: (event) => events.push({ metadata: event.metadata }),
      actorInvokerOverrides: {
        claudeBuilder: async () => processResult(`Claude response\n${secret}`, { stderr: "Bearer token-secret" }),
        codexBuilder: async () => { throw new Error("invalid Claude output must not trigger fallback"); },
      },
    });
    const iteration = result.iterations.at(-1)!;
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.equal(iteration.evidenceKind, "NONE");
    assert.match(iteration.parserError ?? "", /missing or invalid actor=CLAUDE/);
    assert.match(iteration.parserError ?? "", /missing required field readyForPhysicalReplay/);
    assert.ok(iteration.actorResultArtifactPath);
    assert.match(iteration.generatedPromptPath ?? "", /prompts[\\/]iteration-1-claude/);
    assert.notEqual(iteration.actorResultArtifactPath, iteration.generatedPromptPath);
    const artifact = fs.readFileSync(iteration.actorResultArtifactPath!, "utf8");
    assert.match(artifact, /Claude response/);
    assert.match(artifact, /api_key=\[REDACTED\]/);
    assert.match(artifact, /Bearer \[REDACTED\]/);
    assert.doesNotMatch(artifact, /abcdefghijk123456|token-secret/);
    assert.ok(artifact.length <= 32 * 1024 + 20);
    const persisted = JSON.parse(fs.readFileSync(path.join(root, ".artifacts", "orchestrator", task.taskId, "state.json"), "utf8"));
    assert.equal(persisted.iterations.at(-1).parserError, iteration.parserError);
    assert.equal(persisted.iterations.at(-1).actorResultArtifactPath, iteration.actorResultArtifactPath);
    assert.equal(events.at(-1)?.metadata?.parserError, iteration.parserError);
    assert.equal(events.at(-1)?.metadata?.actorResultArtifactPath, iteration.actorResultArtifactPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Claude test failures do not trigger Codex Builder fallback", async () => {
  const output = builderOutput("CLAUDE").replace("failed=0", "failed=1");
  const result = await runWith(processResult(output), async () => { throw new Error("fallback must not run"); });
  assert.equal(result.fallbackCalls, 0);
  assert.equal(result.updated.iterations.at(-1)?.claudeResult?.tests.failed, 1);
});

test("a valid Claude HUMAN_GATE does not invoke Codex Builder", async () => {
  const result = await runWith(processResult(builderOutput("CLAUDE", true)), async () => { throw new Error("fallback must not run"); });
  assert.equal(result.fallbackCalls, 0);
  assert.equal(result.updated.status, "RUNNING");
  const iteration = result.updated.iterations.at(-1)!;
  assert.equal(iteration.evidenceKind, "CLAUDE_RESULT");
  assert.equal(iteration.claudeResult?.result.humanGate, true);
  assert.equal(iteration.claudeResult?.result.sourceChanged, false);
});

test("explicit HUMAN_GATE/sourceChanged wins over quota text and blocks fallback", async () => {
  for (const [output, expectedHumanGate, expectedSourceChanged] of [
    [builderOutput("CLAUDE", true, false), true, false],
    [builderOutput("CLAUDE", false, true), false, true],
    [builderOutput("CLAUDE", true, true), true, true],
  ] as const) {
    const result = await runWith(processResult(output, { exitCode: 1, stderr: "usage limit reached" }), async () => { throw new Error("fallback must not run"); });
    assert.equal(result.fallbackCalls, 0);
    assert.equal(result.updated.status, "RUNNING");
    const iteration = result.updated.iterations.at(-1)!;
    assert.equal(iteration.evidenceKind, "CLAUDE_RESULT");
    assert.equal(iteration.claudeResult?.result.humanGate, expectedHumanGate);
    assert.equal(iteration.claudeResult?.result.sourceChanged, expectedSourceChanged);
    const persistedIteration = result.persisted.iterations.at(-1);
    assert.equal(persistedIteration.evidenceKind, "CLAUDE_RESULT");
    assert.equal(persistedIteration.claudeResult.result.humanGate, expectedHumanGate);
    assert.equal(persistedIteration.claudeResult.result.sourceChanged, expectedSourceChanged);
  }
});

test("invalid successful Claude output fails closed without Codex fallback", async () => {
  const result = await runWith(processResult("not a structured builder result"), async () => { throw new Error("fallback must not run"); });
  assert.equal(result.fallbackCalls, 0);
  assert.equal(result.updated.status, "EXTERNAL_BLOCKER");
});
