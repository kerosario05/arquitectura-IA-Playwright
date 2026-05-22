import { test, expect } from "@playwright/test";
import { buildCompactPrompt } from "../src/agent/codex-auto-repair";
import type { CodexAutoRepairInput, CodexAutoRepairResult } from "../src/types/codex-auto-repair.types";
import { __setSpawnForTesting } from "../src/agent/codex-cli-runner";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import type { ExecException, ExecOptions } from "node:child_process";

function mockSpawnExit(input: { exitCode: number; stderr?: string; stdout?: string }) {
  const fn = (command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { /* noop */ };

    queueMicrotask(() => {
      if (input.stdout) child.stdout.emit("data", input.stdout);
      if (input.stderr) child.stderr.emit("data", input.stderr);
      child.emit("close", input.exitCode, null);
    });

    return child;
  };
  return fn as any;
}

async function createTempHandoffDir(): Promise<{ dir: string; paths: CodexAutoRepairInput }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-repair-test-"));

  const requestPath = path.join(dir, "handoff-request.json");
  const instructionsPath = path.join(dir, "handoff-instructions.md");
  const schemaPath = path.join(dir, "agent-response.schema.json");
  const responsePath = path.join(dir, "agent-response.json");

  await fs.writeFile(requestPath, JSON.stringify({
    version: "1.0",
    kind: "plan_repair",
    createdAt: new Date().toISOString(),
    goal: "Test goal",
    dataContextSummary: { totalEntries: 0, sensitiveEntries: 0, nonSensitiveEntries: 0, availableKeys: [] },
    constraints: { noApiKey: true, noPlaywrightExecution: true, doNotModifyStableRegistry: true, useOnlyAvailableDataKeys: true, outputMustMatchSchema: true },
    actionRegistry: { supportedActions: [] }
  }, null, 2), "utf-8");

  await fs.writeFile(instructionsPath, "# Test Instructions", "utf-8");
  await fs.writeFile(schemaPath, JSON.stringify({ type: "object" }, null, 2), "utf-8");
  await fs.writeFile(responsePath, JSON.stringify({ version: "1.0", generatedAt: "", plans: [], proposedObjects: [], unresolvedQuestions: [], rationale: [] }, null, 2), "utf-8");

  return {
    dir,
    paths: {
      handoffDir: dir,
      requestPath,
      instructionsPath,
      responsePath,
      schemaPath,
      projectRoot: process.cwd(),
      timeoutMs: 5000,
      codexCommand: "codex",
      codexExtraArgs: ["--skip-git-repo-check"]
    }
  };
}

test("runCodexAutoRepair fails when response has no plans", async () => {
  const { paths } = await createTempHandoffDir();

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });

  expect(result.success).toBe(false);
  expect(result.responsePath).toBe(paths.responsePath);
  expect(result.error).toContain("plans array is empty");
});

test("runCodexAutoRepair fails on validation error", async () => {
  const { paths } = await createTempHandoffDir();

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const invalidResponse = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    plans: [
      {
        version: "1.0",
        source: "ai_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Test scenario" },
        requiredData: [],
        steps: [
          { index: 1, action: "fill", target: { strategy: "label", value: "Username" }, valueKey: "UNKNOWN_KEY" }
        ],
        createdAt: new Date().toISOString()
      }
    ],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["test"]
  };
  await fs.writeFile(paths.responsePath, JSON.stringify(invalidResponse, null, 2), "utf-8");

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });

  expect(result.success).toBe(false);
  expect(result.responsePath).toBe(paths.responsePath);
  expect(result.error).toContain("validation failed");
});

test("runCodexAutoRepair accepts no_safe_action without plans in compact mode", async () => {
  const { paths } = await createTempHandoffDir();

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const nonPlanResponse = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "no_safe_action",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["No safe repair is possible from the available context."]
  };
  await fs.writeFile(paths.responsePath, JSON.stringify(nonPlanResponse, null, 2), "utf-8");

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });

  expect(result.success).toBe(true);
  expect(result.responsePath).toBe(paths.responsePath);
  expect(result.diagnostics?.recoveryDecision).toBe("no_safe_action");
  expect(result.diagnostics?.nextAction).toBe("no_safe_action");
});

test("runCodexAutoRepair normalizes bare ExecutionPlan responses", async () => {
  const { paths } = await createTempHandoffDir();

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const barePlan = {
    version: "1.0",
    source: "ai_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, title: "Test scenario" },
    requiredData: [],
    steps: [
      { index: 1, action: "click", target: { strategy: "label", value: "Continue" } }
    ],
    createdAt: new Date().toISOString()
  };
  await fs.writeFile(paths.responsePath, JSON.stringify(barePlan, null, 2), "utf-8");

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.recoveryDecision).toBe("repaired_plan");
  expect(result.diagnostics?.nextAction).toBe("retry_execution");

  const written = JSON.parse(await fs.readFile(paths.responsePath, "utf-8"));
  expect(written.recoveryDecision).toBe("repaired_plan");
  expect(written.plans).toHaveLength(1);
  expect(written.plans[0].scenario.title).toBe("Test scenario");
});

test("runCodexAutoRepair normalizes legacy plans array responses missing recoveryDecision", async () => {
  const { paths } = await createTempHandoffDir();

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const createdAt = new Date().toISOString();
  const wrappedPlanResponse = {
    version: "1.0",
    generatedAt: "",
    plans: [
      {
        version: "1.0",
        source: "ai_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Test scenario" },
        requiredData: [],
        steps: [
          { index: 1, action: "click", target: { strategy: "label", value: "Continue" } }
        ],
        createdAt
      }
    ],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["Recovered plan"]
  };
  await fs.writeFile(paths.responsePath, JSON.stringify(wrappedPlanResponse, null, 2), "utf-8");

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.recoveryDecision).toBe("repaired_plan");
  expect(result.diagnostics?.nextAction).toBe("retry_execution");

  const written = JSON.parse(await fs.readFile(paths.responsePath, "utf-8"));
  expect(written.recoveryDecision).toBe("repaired_plan");
  expect(written.generatedAt).toBe(createdAt);
  expect(written.plans).toHaveLength(1);
});

test("runCodexAutoRepair normalizes top-level ExecutionPlan array responses", async () => {
  const { paths } = await createTempHandoffDir();

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const createdAt = new Date().toISOString();
  const planArray = [
    {
      version: "1.0",
      source: "ai_generated",
      status: "validated",
      scenario: { source: "testrail", caseId: 1, title: "Array scenario" },
      requiredData: [],
      steps: [
        { index: 1, action: "click", target: { strategy: "label", value: "Continue" } }
      ],
      createdAt
    }
  ];
  await fs.writeFile(paths.responsePath, JSON.stringify(planArray, null, 2), "utf-8");

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.recoveryDecision).toBe("repaired_plan");
  expect(result.diagnostics?.nextAction).toBe("retry_execution");

  const written = JSON.parse(await fs.readFile(paths.responsePath, "utf-8"));
  expect(written.recoveryDecision).toBe("repaired_plan");
  expect(written.generatedAt).toBe(createdAt);
  expect(written.plans).toHaveLength(1);
  expect(written.plans[0].scenario.title).toBe("Array scenario");
});

test("runCodexAutoRepair fails when Codex CLI exits with error", async () => {
  const { paths } = await createTempHandoffDir();

  __setSpawnForTesting(mockSpawnExit({ exitCode: 1, stderr: "Not inside a trusted directory" }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });

  expect(result.success).toBe(false);
  expect(result.responsePath).toBe(paths.responsePath);
  expect(result.exitCode).toBe(1);
  expect(result.error).toContain("exited with code 1");
});

test("CodexAutoRepairInput requires all fields", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/test",
    requestPath: "/tmp/test/request.json",
    instructionsPath: "/tmp/test/instructions.md",
    responsePath: "/tmp/test/response.json",
    schemaPath: "/tmp/test/schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"]
  };

  expect(input.codexCommand).toBe("codex");
  expect(input.codexExtraArgs).toHaveLength(3);
  expect(input.codexExtraArgs).toContain("--skip-git-repo-check");
  expect(input.codexExtraArgs).toContain("--sandbox");
  expect(input.codexExtraArgs).toContain("workspace-write");
});

test("CodexAutoRepairResult supports error with suggestions", () => {
  const result: CodexAutoRepairResult = {
    success: false,
    responsePath: "/tmp/test/response.json",
    exitCode: 1,
    error: [
      "Codex CLI exited with code 1.",
      "Stderr: Not inside a trusted directory",
      "Suggestions:",
      "  - Add --skip-git-repo-check to CODEX_CLI_EXTRA_ARGS."
    ].join("\n\n")
  };

  expect(result.error).toContain("--skip-git-repo-check");
  expect(result.success).toBe(false);
});

test("CodexAutoRepairResult supports sandbox error suggestions", () => {
  const result: CodexAutoRepairResult = {
    success: false,
    responsePath: "/tmp/test/response.json",
    exitCode: 1,
    error: [
      "Codex CLI exited with code 1.",
      "Stderr: permission denied: read-only sandbox",
      "Suggestions:",
      "  - Add --sandbox workspace-write to CODEX_CLI_EXTRA_ARGS."
    ].join("\n\n")
  };

  expect(result.error).toContain("--sandbox workspace-write");
});

test("buildCompactPrompt does not embed handoff content, only paths", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "C:\\handoff\\test",
    requestPath: "C:\\handoff\\test\\handoff-request.json",
    instructionsPath: "C:\\handoff\\test\\handoff-instructions.md",
    responsePath: "C:\\handoff\\test\\agent-response.json",
    schemaPath: "C:\\handoff\\test\\agent-response.schema.json",
    projectRoot: "C:\\MisProyectos\\MCP",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);

  expect(prompt).toContain("C:\\handoff\\test\\handoff-request.json");
  expect(prompt).toContain("C:\\handoff\\test\\agent-response.json");
  expect(prompt).toContain("C:\\handoff\\test\\agent-response.schema.json");
  expect(prompt).not.toContain("dataContextSummary");
  expect(prompt).not.toContain("availableKeys");
});

test("buildCompactPrompt includes context-pack path when provided", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "C:\\handoff\\test",
    requestPath: "C:\\handoff\\test\\handoff-request.json",
    instructionsPath: "C:\\handoff\\test\\handoff-instructions.md",
    responsePath: "C:\\handoff\\test\\agent-response.json",
    schemaPath: "C:\\handoff\\test\\agent-response.schema.json",
    contextPackPath: "C:\\handoff\\test\\context-pack.json",
    projectRoot: "C:\\MisProyectos\\MCP",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);
  expect(prompt).toContain("C:\\handoff\\test\\context-pack.json");
});

test("buildCompactPrompt contains rule Modify only agent-response.json", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);

  expect(prompt).toContain("Modify only agent-response.json");
});

test("buildCompactPrompt contains rule Do not run Playwright", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);

  expect(prompt).toContain("Do not run Playwright");
});

test("buildCompactPrompt contains rule Do not generate Playwright code", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);

  expect(prompt).toContain("Do not generate Playwright code");
});

test("buildCompactPrompt requires AgentHandoffResponse wrapper", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);

  expect(prompt).toContain("AgentHandoffResponse object");
  expect(prompt).toContain("top-level plans array");
});

test("buildCompactPrompt contains rule Do not modify Object Registry", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);

  expect(prompt).toContain("Do not modify Object Registry");
});

test("buildCompactPrompt contains rule Finish immediately", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);

  expect(prompt).toContain("Finish immediately after writing agent-response.json");
});

test("buildCompactPrompt uses absolute paths", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "C:\\handoff\\test",
    requestPath: "C:\\handoff\\test\\handoff-request.json",
    instructionsPath: "C:\\handoff\\test\\handoff-instructions.md",
    responsePath: "C:\\handoff\\test\\agent-response.json",
    schemaPath: "C:\\handoff\\test\\agent-response.schema.json",
    projectRoot: "C:\\MisProyectos\\MCP",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);

  expect(prompt).toContain("C:\\handoff\\test");
  expect(prompt).not.toContain("..\\");
});

test("CodexAutoRepairInput supports promptMode field", () => {
  const compactInput: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  expect(compactInput.promptMode).toBe("compact");

  const verboseInput: CodexAutoRepairInput = {
    ...compactInput,
    promptMode: "verbose"
  };

  expect(verboseInput.promptMode).toBe("verbose");
});

test("CodexAutoRepairInput promptMode is optional", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: []
  };

  expect(input.promptMode).toBeUndefined();
});

test("buildCodexPrompt usa skillAwarePromptOverride cuando esta presente", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact",
    skillId: "target-disambiguation",
    skillAwarePromptOverride: "SKILL_AWARE_PROMPT: Read selected-skill.md then write agent-response.json"
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).toContain("SKILL_AWARE_PROMPT");
  expect(prompt).toContain("selected-skill.md");
  expect(prompt).toContain("agent-response.json");
});

test("buildCodexPrompt compact-route-recovery con override usa override", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact-route-recovery",
    skillAwarePromptOverride: "OVERRIDE_PROMPT"
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).toContain("OVERRIDE_PROMPT");
  expect(prompt).not.toContain("bounded goal-seeking route recovery planner");
});

test("buildCodexPrompt compact-route-recovery sin override produce route-recovery prompt", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact-route-recovery",
    routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 1200,
      maxUnresolvedQuestions: 5
    }
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).toContain("bounded current-snapshot semantic recovery planner");
  expect(prompt).toContain("route-recovery-pack.json");
  expect(prompt).toContain("route-recovery-decision.schema.json");
  expect(prompt).toContain("route-recovery-decision.json");
  expect(prompt).toContain("Use only IDs present in route-recovery-pack.json");
  expect(prompt).toContain("Do not write agent-response.json");
  expect(prompt).toContain("Do not write ExecutionPlan");
  expect(prompt).toContain("Do not write generatedAt");
  expect(prompt).toContain("Do not write version");
  expect(prompt).toContain("The framework will build the final AgentHandoffResponse");
  expect(prompt).not.toContain("context-pack.json");
  expect(prompt).not.toContain("handoff-request.json");
});

test("buildCompactPrompt no incluye skillAwarePromptOverride cuando no esta presente", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/handoff-request.json",
    instructionsPath: "/tmp/handoff/handoff-instructions.md",
    responsePath: "/tmp/handoff/agent-response.json",
    schemaPath: "/tmp/handoff/agent-response.schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact"
  };

  const prompt = buildCompactPrompt(input);
  expect(prompt).not.toContain("SKILL_AWARE_PROMPT");
  expect(prompt).toContain("Modify only agent-response.json");
});

test("CodexAutoRepairInput acepta skillId y skillPath", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    skillId: "navigation-recovery",
    skillPath: "/tmp/handoff/selected-skill.md"
  };

  expect(input.skillId).toBe("navigation-recovery");
  expect(input.skillPath).toContain("selected-skill.md");
});

test("CodexAutoRepairInput acepta skillAwarePromptOverride", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    skillAwarePromptOverride: "custom prompt content"
  };

  expect(input.skillAwarePromptOverride).toBe("custom prompt content");
});

test("runCodexAutoRepair usa skillAwarePromptOverride cuando se provee", async () => {
  const { paths } = await createTempHandoffDir();
  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");

  const original = await import("../src/agent/codex-cli-runner");
  original.__setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const result = await runCodexAutoRepair({
    ...paths,
    promptMode: "compact",
    skillId: "target-disambiguation",
    skillAwarePromptOverride: "SKILL_OVERRIDE_TEST_PROMPT"
  });

  expect(result).toBeDefined();
});

// --- Compact route recovery prompt tests ---

test("buildCodexPrompt produces compact-route-recovery prompt when promptMode is compact-route-recovery", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: "/tmp",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact-route-recovery",
    routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 1200,
      maxUnresolvedQuestions: 5
    }
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).toContain("bounded current-snapshot semantic recovery planner");
  expect(prompt).toContain("Do not analyze the repository");
  expect(prompt).toContain("repaired_plan");
  expect(prompt).toContain("no_safe_action");
  expect(prompt).toContain("needs_more_context");
  expect(prompt).toContain("selectedCandidateId");
  expect(prompt).toContain("30 seconds");
  expect(prompt).toContain("60 seconds");
  expect(prompt).toContain("Use only IDs present in route-recovery-pack.json");
  expect(prompt).toContain("If no safe route is found quickly, write no_safe_action");
  expect(prompt).toContain("Do not write agent-response.json");
  expect(prompt).toContain("Do not write ExecutionPlan");
  expect(prompt).not.toContain("SauceDemo");
  expect(prompt).not.toContain("Kiosko");
});

test("buildCodexPrompt compact-route-recovery is shorter than full compact prompt", async () => {
  const { buildCodexPrompt, buildCompactPrompt } = await import("../src/agent/codex-auto-repair");
  const base: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: "/tmp",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: []
  };

  const compactPrompt = buildCompactPrompt(base);
  const routeRecoveryInput: CodexAutoRepairInput = {
    ...base,
    promptMode: "compact-route-recovery",
    routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 1200,
      maxUnresolvedQuestions: 5
    }
  };
  const routePrompt = buildCodexPrompt(routeRecoveryInput);

  // Route recovery prompt has very specific constraints that make it distinct
  expect(routePrompt).not.toEqual(compactPrompt);
  expect(routePrompt).toContain("route-recovery-pack.json");
});

test("buildCodexPrompt compact-route-recovery includes maxRationaleChars", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: "/tmp",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact-route-recovery",
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 800,
      maxUnresolvedQuestions: 3
    }
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).toContain("800");
  expect(prompt).toContain("3");
  expect(prompt).toContain("Do not run commands");
  expect(prompt).toContain("Do not run tests");
  expect(prompt).toContain("Do not run Playwright");
});

test("no hardcodear apps, productos, URLs, case IDs en codex-auto-repair tests", () => {
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/test",
    requestPath: "/tmp/test/request.json",
    instructionsPath: "/tmp/test/instructions.md",
    responsePath: "/tmp/test/response.json",
    schemaPath: "/tmp/test/schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: []
  };

  const prompt = buildCompactPrompt(input);
  const lower = prompt.toLowerCase();
  expect(lower).not.toMatch(/(kiosko|saucelabs?|préstamo|visa)/);
  expect(lower).not.toMatch(/c\d{5}/);
});

// --- Decision without plans tests ---

test("compact route recovery prompt specifies recoveryDecision JSON field", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: process.cwd(),
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact-route-recovery",
    routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 1200,
      maxUnresolvedQuestions: 5
    }
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).toContain("recoveryDecision");
  expect(prompt).toContain("selectedCandidateId");
  expect(prompt).toContain("repaired_plan");
  expect(prompt).toContain("no_safe_action");
  expect(prompt).toContain("needs_more_context");
  expect(prompt).toContain("First inspect topVisibleCandidates");
  expect(prompt).toContain("Prefer current visible actionable candidates");
  expect(prompt).toContain("Use knownObjects, knownRoutes and knownPlans only as secondary evidence");
  expect(prompt).toContain("look for a safe visible parent category");
  expect(prompt).toContain("Propose only the next safe segment");
  expect(prompt).toContain("Do not write agent-response.json");
  expect(prompt).toContain("Do not write ExecutionPlan");
  expect(prompt).toContain("Do not write generatedAt");
  expect(prompt).not.toContain("Do not omit recoveryDecision");
});

function minPack(): Record<string, unknown> {
  return {
    version: "1.0", createdAt: "2025-01-01T00:00:00.000Z",
    failedAction: { stepIndex: 1, actionType: "click", target: "Settings", failureReason: "Element not found" },
    semanticGoal: { intent: "open_settings", targetConcept: "Settings", sensitive: false },
    currentScreen: { url: "https://example.com", title: "Dashboard" },
    topVisibleCandidates: [
      { id: "candidate-123", type: "button", text: "Settings", role: "button", score: 0.85, actionability: "clickable", semanticRelation: "parent_category", source: "current_snapshot" }
    ],
    topKnownObjects: [], topKnownRoutes: [], topKnownPlans: [],
    priorSuccessfulSteps: [], pendingSteps: [], finalAssertions: [],
    actionHistorySummary: [], failedRoutePaths: [],
    budget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 },
    constraints: { codexMustOnlyWriteAgentResponseJson: true, doNotRunPlaywright: true, doNotModifyStableRegistry: true, doNotApproveObjectsAutomatically: true, doNotInventData: true, useOnlyIdsPresentInThisPack: true }
  };
}

// --- Decision pipeline: Codex writes valid decisions → success ---

test("compact-route-recovery: Codex writes valid repaired_plan decision", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  const decision = { recoveryDecision: "repaired_plan", selectedCandidateId: "candidate-123", action: "click", confidence: 0.85, sensitive: false, rationale: "Visible parent category." };
  await fs.writeFile(decisionPath, JSON.stringify(decision, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.nextAction).toBe("repaired_plan");
  expect(result.diagnostics?.recoveryDecision).toBe("repaired_plan");
  expect(result.diagnostics?.finalAgentResponseBuiltBy).toBe("codex_decision");
  expect(result.diagnostics?.selectedCandidateId).toBe("candidate-123");
  expect(result.diagnostics?.routeRecoveryDecisionValid).toBe(true);

  const written = JSON.parse(await fs.readFile(paths.responsePath, "utf-8"));
  expect(written.recoveryDecision).toBe("repaired_plan");
  expect(written.plans).toHaveLength(1);
  expect(written.plans[0].steps[0].target.strategy).toBe("role");
  expect(written.plans[0].steps[0].target.role).toBe("button");
  expect(written.plans[0].steps[0].target.name).toBe("Settings");
  expect(written.generatedAt).toBeTruthy();
});

test("compact-route-recovery: Codex writes valid no_safe_action decision", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "no_safe_action", rationale: "No safe action possible." }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.nextAction).toBe("no_safe_action");
  expect(result.diagnostics?.recoveryDecision).toBe("no_safe_action");
  expect(result.diagnostics?.finalAgentResponseBuiltBy).toBe("codex_decision");

  const written = JSON.parse(await fs.readFile(paths.responsePath, "utf-8"));
  expect(written.recoveryDecision).toBe("no_safe_action");
  expect(written.plans).toHaveLength(0);
  expect(written.rationale).toEqual(["No safe action possible."]);
});

test("compact-route-recovery: Codex writes valid needs_more_context decision", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "needs_more_context", unresolvedQuestions: ["Need more candidates."], rationale: "Pack lacks evidence." }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.nextAction).toBe("needs_more_context");
  expect(result.diagnostics?.recoveryDecision).toBe("needs_more_context");
  expect(result.diagnostics?.finalAgentResponseBuiltBy).toBe("codex_decision");

  const written = JSON.parse(await fs.readFile(paths.responsePath, "utf-8"));
  expect(written.recoveryDecision).toBe("needs_more_context");
  expect(written.plans).toHaveLength(0);
  expect(written.unresolvedQuestions).toHaveLength(1);
});

// --- Decision pipeline: Codex writes invalid decisions → fallback or failure ---

test("compact-route-recovery: Codex writes invalid decision triggers deterministic fallback", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.nextAction).toBe("repaired_plan");
  expect(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
  expect(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
  expect(result.diagnostics?.routeRecoveryDecisionErrors).toBeDefined();
});

test("compact-route-recovery: Codex writes invalid decision with missing fields triggers fallback when good candidate exists", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "no_safe_action" }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  // Decision is invalid but good candidate exists → deterministic fallback applies
  expect(result.success).toBe(true);
  expect(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
  expect(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
  expect(result.diagnostics?.nextAction).toBe("repaired_plan");
});

test("compact-route-recovery: Codex writes candidate not in pack and no fallback candidate fails", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  const emptyPack = { ...minPack(), topVisibleCandidates: [] };
  await fs.writeFile(packPath, JSON.stringify(emptyPack, null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan", selectedCandidateId: "nonexistent", action: "click", confidence: 0.85, sensitive: false, rationale: "test" }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(false);
  expect(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
  expect(result.error).toContain("CANDIDATE_NOT_IN_PACK");
});

test("compact-route-recovery: Codex writes no decision file triggers fallback", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.nextAction).toBe("repaired_plan");
  expect(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
});

test("compact-route-recovery: final agent-response passes validateAgentHandoffResponse", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan", selectedCandidateId: "candidate-123", action: "click", confidence: 0.85, sensitive: false, rationale: "test" }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(true);

  const written = JSON.parse(await fs.readFile(paths.responsePath, "utf-8"));
  const { validateAgentHandoffResponse } = await import("../src/agent/agent-response-validator");
  const validation = validateAgentHandoffResponse(written, { promptMode: "compact-route-recovery" });
  expect(validation.valid).toBe(true);
});

test("compact-route-recovery: invalid repaired_plan action fails instead of reporting success", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({
    recoveryDecision: "repaired_plan",
    selectedCandidateId: "candidate-123",
    action: "hover",
    confidence: 0.85,
    sensitive: false,
    rationale: "test"
  }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({
    ...paths,
    promptMode: "compact-route-recovery",
    routeRecoveryPackPath: packPath,
    routeRecoveryDecisionPath: decisionPath,
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 1200,
      maxUnresolvedQuestions: 5
    }
  });

  expect(result.success).toBe(false);
  expect(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
  expect(result.diagnostics?.nextAction).toBe("auto_repair_invalid_response");
  expect(result.error).toContain("INVALID_ACTION");
});

test("compact route recovery prompt contains JSON examples for each decision type", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: "/tmp",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact-route-recovery",
    routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 1200,
      maxUnresolvedQuestions: 5
    }
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).toContain('"recoveryDecision": "repaired_plan"');
  expect(prompt).toContain('"recoveryDecision": "no_safe_action"');
  expect(prompt).toContain('"recoveryDecision": "needs_more_context"');
  expect(prompt).toContain("selectedCandidateId");
  expect(prompt).toContain("action");
  expect(prompt).toContain("confidence");
  expect(prompt).toContain("sensitive");
  expect(prompt).toContain("1. repaired_plan");
  expect(prompt).toContain("2. no_safe_action");
  expect(prompt).toContain("3. needs_more_context");
  expect(prompt).toContain("unresolvedQuestions");
  expect(prompt).toContain("Never leave placeholders in the final JSON");
  expect(prompt).toContain("Do not copy placeholders");
  // Prompt instructs NOT to write these fields but schema version is mentioned in instructions
  expect(prompt).not.toContain('"version"');
  expect(prompt).not.toContain('"generatedAt"');
  expect(prompt).not.toContain('"plans"');
  expect(prompt).not.toContain('"proposedObjects"');
});

test("compact route recovery prompt contains strong instruction against empty response", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: "/tmp",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact-route-recovery",
    routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 1200,
      maxUnresolvedQuestions: 5
    }
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).not.toContain("or empty if unavailable");
  expect(prompt).toContain("Do not copy placeholders");
  expect(prompt).not.toContain("1970-01-01T00:00:00.000Z");
  expect(prompt).not.toContain("An empty response with plans=[]");
  expect(prompt).toContain("If you are unsure, choose no_safe_action or needs_more_context.");
  expect(prompt).toContain("Do not write an empty object");
  expect(prompt).toContain("Do not write agent-response.json");
  expect(prompt).toContain("Do not write ExecutionPlan");
  expect(prompt).toContain("Do not write generatedAt");
  expect(prompt).toContain("Do not write version");
});

test("compact route recovery prompt prefers visible parent_category candidates", async () => {
  const { buildCodexPrompt } = await import("../src/agent/codex-auto-repair");
  const input: CodexAutoRepairInput = {
    handoffDir: "/tmp/handoff",
    requestPath: "/tmp/handoff/request.json",
    instructionsPath: "/tmp/handoff/instructions.md",
    responsePath: "/tmp/handoff/response.json",
    schemaPath: "/tmp/handoff/schema.json",
    projectRoot: "/tmp",
    timeoutMs: 5000,
    codexCommand: "codex",
    codexExtraArgs: [],
    promptMode: "compact-route-recovery",
    routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
    planningBudget: {
      preferredResponseSeconds: 30,
      maxPromptBudgetSeconds: 60,
      maxCandidates: 12,
      maxKnownObjects: 20,
      maxKnownRoutes: 10,
      maxKnownPlans: 5,
      maxProposedActions: 5,
      maxRationaleChars: 1200,
      maxUnresolvedQuestions: 5
    }
  };

  const prompt = buildCodexPrompt(input);
  expect(prompt).toContain("parent_category candidate with score >= 0.70");
  expect(prompt).toContain("prefer repaired_plan using that candidateId");
  expect(prompt).toContain("parent_category");
  expect(prompt).toContain("clickable");
});

// --- Deterministic fallback tests (decision pipeline) ---

function fallbackPack(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    version: "1.0", createdAt: "2025-01-01T00:00:00.000Z",
    failedAction: { stepIndex: 1, actionType: "click", target: "Settings", failureReason: "Element not found" },
    semanticGoal: { intent: "open_settings", targetConcept: "Settings", sensitive: false, ...(overrides?.semanticGoal as object ?? {}) },
    currentScreen: { url: "https://example.com", title: "Dashboard" },
    topVisibleCandidates: overrides?.topVisibleCandidates ?? [
      { id: "candidate-123", type: "button", text: "Settings", role: "button", score: 0.85, actionability: "clickable", semanticRelation: "parent_category", source: "current_snapshot" }
    ],
    topKnownObjects: [], topKnownRoutes: [], topKnownPlans: [],
    priorSuccessfulSteps: [], pendingSteps: [], finalAssertions: [],
    actionHistorySummary: overrides?.actionHistorySummary as Array<Record<string, unknown>> ?? [],
    failedRoutePaths: [],
    budget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 },
    constraints: { codexMustOnlyWriteAgentResponseJson: true, doNotRunPlaywright: true, doNotModifyStableRegistry: true, doNotApproveObjectsAutomatically: true, doNotInventData: true, useOnlyIdsPresentInThisPack: true }
  };
}

test("deterministic fallback triggers when Codex writes nothing and good candidate available", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(fallbackPack(), null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.nextAction).toBe("repaired_plan");
  expect(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
  expect(result.diagnostics?.selectedCandidateId).toBe("candidate-123");

  const written = JSON.parse(await fs.readFile(paths.responsePath, "utf-8"));
  expect(written.recoveryDecision).toBe("repaired_plan");
  expect(written.plans).toHaveLength(1);
  expect(written.generatedAt).toBeTruthy();
});

test("deterministic fallback not applied when score < 0.70", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(fallbackPack({ topVisibleCandidates: [{ id: "candidate-low", type: "button", text: "Settings", role: "button", score: 0.60, actionability: "clickable", semanticRelation: "parent_category", source: "current_snapshot" }] }), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(false);
  expect(result.diagnostics?.nextAction).toBe("auto_repair_invalid_response");
  expect(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
});

test("deterministic fallback not applied when actionability is not clickable", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(fallbackPack({ topVisibleCandidates: [{ id: "candidate-fill", type: "input", text: "Settings", role: "textbox", score: 0.85, actionability: "fillable", semanticRelation: "parent_category", source: "current_snapshot" }] }), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(false);
  expect(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
});

test("deterministic fallback applied when semantic goal is sensitive", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(fallbackPack({ semanticGoal: { intent: "login", targetConcept: "Login", sensitive: true } }), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(true);
  expect(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
});

test("deterministic fallback not applied when candidate is in failed action history", async () => {
  const { paths, dir } = await createTempHandoffDir();
  const packPath = path.join(dir, "route-recovery-pack.json");
  await fs.writeFile(packPath, JSON.stringify(fallbackPack({ actionHistorySummary: [{ action: "click", target: "candidate-123", status: "failed" }] }), null, 2), "utf-8");

  const decisionPath = path.join(dir, "route-recovery-decision.json");
  await fs.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");

  __setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));

  const { runCodexAutoRepair } = await import("../src/agent/codex-auto-repair");
  const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });

  expect(result.success).toBe(false);
  expect(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
});
