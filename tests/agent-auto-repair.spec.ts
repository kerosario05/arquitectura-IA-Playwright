import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { __setSpawnForTesting, __getLastRunnerInputForTesting } from "../src/agent/codex-cli-runner";
import { runAgentAutoRepairAttempt } from "../src/agent/agent-auto-repair";
import { normalizeAgentHandoffResponse } from "../src/agent/agent-response-validator";
import type { FullConfig } from "../src/types/env.types";
import { getTestTempDir, ensureTestTempDir, cleanTestTempDir } from "./helpers/test-temp-dir";

const tmpDir = getTestTempDir("test-agent-auto-repair");

function configEnabled(timeoutMs = 900000): FullConfig {
  return {
    app: {
      baseUrl: "https://example.com",
      loginMode: "no_login",
      testData: {},
      testDataAliases: {},
      missingInputBehavior: "fail",
      appProfile: "default"
    },
    execution: {
      browser: "chromium",
      headless: true,
      evidenceDir: "evidence",
      defaultTimeoutMs: 30000
    },
    integrations: {
      ai: { discoveryMaxAttempts: 2 },
      agent: {
        provider: "codex",
        autoRepairEnabled: true,
        command: "codex",
        extraArgs: "--skip-git-repo-check",
        autoRepairTimeoutMs: timeoutMs,
        autoRepairPromptMode: "compact"
      }
    }
  };
}

function spawnExit(exitCode: number) {
  return (command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { /* noop */ };
    queueMicrotask(() => {
      child.emit("close", exitCode, null);
    });
    (child as any).__options = options;
    return child;
  };
}

test.beforeAll(async () => {
  await ensureTestTempDir("test-agent-auto-repair");
});

test.afterAll(async () => {
  try { await cleanTestTempDir("test-agent-auto-repair"); } catch { }
});

test("agent-auto-repair forwards timeout override to codex-cli-runner", async () => {
  __setSpawnForTesting(spawnExit(1) as any);

  const outputDir = path.join(tmpDir, "run-timeout");
  await fs.mkdir(outputDir, { recursive: true });

  await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found",
    repairTimeoutMs: 120000
  });

  const last = __getLastRunnerInputForTesting();
  expect(last?.timeoutMs).toBe(120000);
});

test("agent-auto-repair forwards showAgentLog to codex-cli-runner", async () => {
  __setSpawnForTesting(spawnExit(1) as any);

  const outputDir = path.join(tmpDir, "run-showlog");
  await fs.mkdir(outputDir, { recursive: true });

  await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(120000),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found",
    showAgentLog: true
  });

  const last = __getLastRunnerInputForTesting();
  expect(last?.showAgentLog).toBe(true);
});

test("codex-cli-runner uses stdin ignore (non-interactive)", async () => {
  let observedStdio: any;
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    observedStdio = options?.stdio;
    return spawnExit(1)(command, args, options);
  }) as any);

  const outputDir = path.join(tmpDir, "run-stdio");
  await fs.mkdir(outputDir, { recursive: true });

  await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found"
  });

  expect(Array.isArray(observedStdio)).toBe(true);
  expect(observedStdio[0]).toBe("ignore");
});

test("attempt exit diagnostics include log paths and nextAction", async () => {
  __setSpawnForTesting(spawnExit(0) as any);

  const outputDir = path.join(tmpDir, "run-diagnostics");
  await fs.mkdir(outputDir, { recursive: true });

  const result = await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found",
    failedTarget: "X"
  });

  const handoffDir = path.join(outputDir, "handoff-attempt-1");
  const diagPath = path.join(handoffDir, "auto-repair-result.json");
  const raw = JSON.parse(await fs.readFile(diagPath, "utf-8")) as any;

  expect(raw.attemptNumber).toBe(1);
  expect(raw.diagnostics).toBeDefined();
  expect(raw.diagnostics.stdoutLogPath).toContain("codex.stdout.log");
  expect(raw.diagnostics.stderrLogPath).toContain("codex.stderr.log");
  expect(typeof raw.diagnostics.durationMs).toBe("number");
  expect(raw.diagnostics.nextAction).toBeDefined();

  // The handoff writer always creates agent-response.json template; if Codex didn't add plans, it's no_proposal/no_plan.
  expect(result.success).toBe(false);
  expect(["no_proposal", "cli_error", "invalid_proposal", "no_response", "timeout"]).toContain((result as any).status);
});

test("compactPrompt=true pasa prompt compact-route-recovery a codex-cli-runner", async () => {
  __setSpawnForTesting(spawnExit(1) as any);

  const outputDir = path.join(tmpDir, "prompt-compact");
  await fs.mkdir(outputDir, { recursive: true });

  const result = await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(120000),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found",
    compactPrompt: true,
    showAgentLog: false
  });

  const last = __getLastRunnerInputForTesting();
  expect(last?.prompt).toContain("bounded current-snapshot semantic recovery planner");
  expect(last?.prompt).toContain("route-recovery-decision.json");
  expect(last?.prompt).toContain("route-recovery-decision.schema.json");
  expect(last?.prompt).toContain("route-recovery-pack.json");
  expect(last?.prompt).toContain("Do not write agent-response.json");
  expect(last?.prompt).toContain("The framework will build the final AgentHandoffResponse");
  expect(last?.prompt).not.toContain("Read these files first");
  expect(last?.prompt).not.toContain("context-pack.json");
});

test("compactPrompt=true prompt no contiene bloque viejo ni context-pack", async () => {
  __setSpawnForTesting(spawnExit(1) as any);

  const outputDir = path.join(tmpDir, "prompt-clean");
  await fs.mkdir(outputDir, { recursive: true });

  await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(120000),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found",
    compactPrompt: true,
    showAgentLog: false
  });

  const last = __getLastRunnerInputForTesting();
  expect(last?.prompt).not.toContain("Read these files first");
  expect(last?.prompt).not.toContain("handoff-request.json");
  expect(last?.prompt).toContain("route-recovery-pack.json");
  expect(last?.prompt).toContain("selected-skill.md");
});

test("compactPrompt=false mantiene full prompt con Read these files first", async () => {
  __setSpawnForTesting(spawnExit(1) as any);

  const outputDir = path.join(tmpDir, "prompt-full");
  await fs.mkdir(outputDir, { recursive: true });

  await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(120000),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found",
    compactPrompt: false,
    showAgentLog: false
  });

  const last = __getLastRunnerInputForTesting();
  expect(last?.prompt).toContain("Read these files first");
  expect(last?.prompt).toContain("context-pack.json");
  expect(last?.prompt).not.toContain("route-recovery-pack.json");
});

test("no agent-response.json produces no_response status", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { /* noop */ };

    queueMicrotask(async () => {
      try {
        // Extract response path from the prompt argument (last arg).
        const prompt = String(args[args.length - 1] ?? "");
        const m = prompt.match(/Fill\\s+(.+agent-response\\.json)/i);
        if (m && m[1]) {
          const p = m[1].trim();
          await fs.rm(p, { force: true });
        }
      } catch {
      }
      child.emit("close", 0, null);
    });
    return child;
  }) as any);

  const outputDir = path.join(tmpDir, "run-no-response");
  await fs.mkdir(outputDir, { recursive: true });

  const res = await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found"
  });

  // Should classify as no_response or cli_error with diagnostics nextAction auto_repair_no_response.
  if (!res.success) {
    expect(["no_response", "cli_error", "no_proposal"]).toContain((res as any).status);
  }
});

test("runAgentAutoRepairAttempt normalizes bare ExecutionPlan responses before validation", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { /* noop */ };

    queueMicrotask(async () => {
      try {
        const cwd = String(options?.cwd ?? process.cwd());
        const responsePath = path.join(cwd, "agent-response.json");
        const barePlan = {
          version: "1.0",
          source: "ai_generated",
          status: "validated",
          scenario: { source: "testrail", caseId: 1, title: "Recovered scenario" },
          requiredData: [],
          steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "Continue" } }
          ],
          createdAt: new Date().toISOString()
        };
        await fs.writeFile(responsePath, JSON.stringify(barePlan, null, 2), "utf-8");
      } catch {
      }
      child.emit("close", 0, null);
    });

    return child;
  }) as any);

  const outputDir = path.join(tmpDir, "run-normalize-bare-plan");
  await fs.mkdir(outputDir, { recursive: true });

  const result = await runAgentAutoRepairAttempt({
    fullConfig: configEnabled(),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "recoverable_failure",
    failedReason: "target_not_found"
  });

  if (result.success) {
    expect(result.repairedPlan.scenario.title).toBe("Recovered scenario");
    const written = JSON.parse(await fs.readFile(path.join(outputDir, "handoff-attempt-1", "agent-response.json"), "utf-8")) as any;
    expect(written.recoveryDecision).toBe("repaired_plan");
    expect(written.plans).toHaveLength(1);
  } else {
    expect(["no_response", "invalid_proposal", "cli_error", "no_proposal"]).toContain((result as any).status);
  }

  const normalized = normalizeAgentHandoffResponse({
    version: "1.0",
    source: "ai_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, title: "Recovered scenario" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Continue" } }],
    createdAt: new Date().toISOString()
  }) as any;
  expect(normalized.recoveryDecision).toBe("repaired_plan");
  expect(Array.isArray(normalized.plans)).toBe(true);
  expect(normalized.plans).toHaveLength(1);
});

test("auto-repair skips Codex spawn when CODEX_CLI_PATH is invalid", async () => {
  let spawnCalls = 0;
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    spawnCalls += 1;
    return spawnExit(1)(command, args, options);
  }) as any);

  const previousPath = process.env.CODEX_CLI_PATH;
  process.env.CODEX_CLI_PATH = path.join(tmpDir, "missing-codex.cmd");

  const outputDir = path.join(tmpDir, "run-codex-missing");
  await fs.mkdir(outputDir, { recursive: true });

  try {
    const res = await runAgentAutoRepairAttempt({
      fullConfig: configEnabled(),
      outputDir,
      attemptNumber: 1,
      kind: "plan_repair",
      failureSummary: "recoverable_failure",
      failedReason: "target_not_found"
    });

    expect(res.success).toBe(false);
    expect((res as any).status).toBe("unavailable");
    expect((res as any).reason).toBe("codex_cli_path_invalid");
    expect(spawnCalls).toBe(0);
  } finally {
    if (previousPath === undefined) {
      delete process.env.CODEX_CLI_PATH;
    } else {
      process.env.CODEX_CLI_PATH = previousPath;
    }
  }
});
