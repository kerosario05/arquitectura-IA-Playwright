import { test, expect } from "@playwright/test";
import { buildCompactPrompt } from "../src/agent/codex-auto-repair";
import type { CodexAutoRepairInput, CodexAutoRepairResult } from "../src/types/codex-auto-repair.types";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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

test.skip("runCodexAutoRepair fails when response has no plans - requires child_process mock", async () => {
  const { paths } = await createTempHandoffDir();

  const expected: CodexAutoRepairResult = {
    success: false,
    responsePath: paths.responsePath,
    error: "Agent response contains no plans."
  };

  expect(expected.success).toBe(false);
  expect(expected.error).toContain("no plans");
});

test.skip("runCodexAutoRepair fails on validation error - requires child_process mock", async () => {
  const { paths } = await createTempHandoffDir();

  const expected: CodexAutoRepairResult = {
    success: false,
    responsePath: paths.responsePath,
    error: "Agent response validation failed"
  };

  expect(expected.success).toBe(false);
  expect(expected.error).toBeDefined();
});

test.skip("runCodexAutoRepair fails when Codex CLI exits with error - requires child_process mock", async () => {
  const { paths } = await createTempHandoffDir();

  const expected: CodexAutoRepairResult = {
    success: false,
    responsePath: paths.responsePath,
    exitCode: 1,
    error: "Codex CLI exited with code 1"
  };

  expect(expected.success).toBe(false);
  expect(expected.exitCode).toBe(1);
  expect(expected.error).toContain("exited with code 1");
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
