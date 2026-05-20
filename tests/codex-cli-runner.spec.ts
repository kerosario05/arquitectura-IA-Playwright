import { test, expect } from "@playwright/test";
import { buildCommand, formatCodexCliError, formatCodexTimeoutError, escapeDoubleQuotes, buildErrorSuggestions } from "../src/agent/codex-cli-runner";
import type { CodexCliRunnerInput, CodexCliRunnerResult } from "../src/types/codex-auto-repair.types";

test("escapeDoubleQuotes escapes double quotes in prompt", () => {
  expect(escapeDoubleQuotes('say "hello"')).toBe('say \\"hello\\"');
});

test("escapeDoubleQuotes leaves clean strings unchanged", () => {
  expect(escapeDoubleQuotes("hello world")).toBe("hello world");
});

test("buildCommand produces correct order: command exec extraArgs prompt", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"],
    prompt: "Read the file",
    cwd: process.cwd(),
    timeoutMs: 5000
  };

  const command = buildCommand(input);

  expect(command).toBe('codex exec --skip-git-repo-check --sandbox workspace-write "Read the file"');
});

test("buildCommand works with empty extraArgs", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Simple task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };

  const command = buildCommand(input);

  expect(command).toBe('codex exec "Simple task"');
});

test("buildCommand works with absolute path command", () => {
  const input: CodexCliRunnerInput = {
    command: "C:\\Users\\radames\\AppData\\Roaming\\npm\\codex.cmd",
    extraArgs: ["--skip-git-repo-check"],
    prompt: "Task",
    cwd: "C:\\MisProyectos\\MCP",
    timeoutMs: 5000
  };

  const command = buildCommand(input);

  expect(command).toContain("codex.cmd");
  expect(command).toContain("--skip-git-repo-check");
  expect(command).toContain('"Task"');
  expect(command.startsWith("C:\\")).toBe(true);
});

test("buildCommand quotes command path with spaces", () => {
  const input: CodexCliRunnerInput = {
    command: "C:\\Program Files\\codex.cmd",
    extraArgs: [],
    prompt: "Task",
    cwd: "C:\\MisProyectos\\MCP",
    timeoutMs: 5000
  };

  const command = buildCommand(input);

  expect(command).toContain('"C:\\Program Files\\codex.cmd"');
});

test("buildCommand escapes double quotes in prompt", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: 'Write {"key": "value"} to file',
    cwd: process.cwd(),
    timeoutMs: 5000
  };

  const command = buildCommand(input);

  expect(command).toContain('Write {\\"key\\": \\"value\\"} to file');
});

test("formatCodexCliError includes exitCode, command, cwd", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: ["--skip-git-repo-check"],
    prompt: "Task",
    cwd: "C:\\MisProyectos\\MCP",
    timeoutMs: 5000
  };
  const result: CodexCliRunnerResult = {
    exitCode: 1,
    stdout: "some output",
    stderr: "some error",
    timedOut: false
  };

  const message = formatCodexCliError(result, input);

  expect(message).toContain("exited with code 1");
  expect(message).toContain("codex exec --skip-git-repo-check");
  expect(message).toContain("C:\\MisProyectos\\MCP");
});

test("formatCodexCliError includes stdout when present", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };
  const result: CodexCliRunnerResult = {
    exitCode: 1,
    stdout: "codex-cli 0.131.0\nProcessing...",
    stderr: "",
    timedOut: false
  };

  const message = formatCodexCliError(result, input);

  expect(message).toContain("Stdout");
  expect(message).toContain("codex-cli 0.131.0");
});

test("formatCodexCliError includes stderr when present", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };
  const result: CodexCliRunnerResult = {
    exitCode: 1,
    stdout: "",
    stderr: "Error: Not inside a trusted directory",
    timedOut: false
  };

  const message = formatCodexCliError(result, input);

  expect(message).toContain("Stderr");
  expect(message).toContain("Not inside a trusted directory");
});

test("formatCodexCliError includes signal when present", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };
  const result: CodexCliRunnerResult = {
    exitCode: 1,
    stdout: "",
    stderr: "",
    timedOut: false,
    signal: "SIGTERM"
  };

  const message = formatCodexCliError(result, input);

  expect(message).toContain("SIGTERM");
});

test("formatCodexCliError suggests --skip-git-repo-check when stderr contains trusted directory", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };
  const result: CodexCliRunnerResult = {
    exitCode: 1,
    stdout: "",
    stderr: "Error: Not inside a trusted directory. Run with --skip-git-repo-check.",
    timedOut: false
  };

  const message = formatCodexCliError(result, input);

  expect(message).toContain("--skip-git-repo-check");
  expect(message).toContain("Suggestions");
});

test("formatCodexCliError suggests --sandbox workspace-write when stderr contains read-only", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };
  const result: CodexCliRunnerResult = {
    exitCode: 1,
    stdout: "",
    stderr: "Error: Cannot write to read-only sandbox.",
    timedOut: false
  };

  const message = formatCodexCliError(result, input);

  expect(message).toContain("--sandbox workspace-write");
});

test("formatCodexCliError suggests absolute path when command not found", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };
  const result: CodexCliRunnerResult = {
    exitCode: 1,
    stdout: "",
    stderr: "'codex' is not recognized as an internal or external command",
    timedOut: false
  };

  const message = formatCodexCliError(result, input);

  expect(message).toContain("CODEX_CLI_COMMAND");
  expect(message).toContain("codex.cmd");
});

test("formatCodexCliError truncates long stdout", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };
  const longOutput = "x".repeat(2000);
  const result: CodexCliRunnerResult = {
    exitCode: 1,
    stdout: longOutput,
    stderr: "",
    timedOut: false
  };

  const message = formatCodexCliError(result, input);

  expect(message).toContain("truncated");
  expect(message).not.toContain("x".repeat(2000));
});

test("buildErrorSuggestions returns empty when no known patterns", () => {
  const suggestions = buildErrorSuggestions("Some unknown error", "codex exec task");

  expect(suggestions).toBe("");
});

test("buildErrorSuggestions detects trusted directory error", () => {
  const suggestions = buildErrorSuggestions("Not inside a trusted directory", "codex exec task");

  expect(suggestions).toContain("--skip-git-repo-check");
});

test("buildErrorSuggestions detects sandbox write error", () => {
  const suggestions = buildErrorSuggestions("permission denied: cannot write in read-only mode", "codex exec task");

  expect(suggestions).toContain("--sandbox workspace-write");
});

test("buildErrorSuggestions detects command not found", () => {
  const suggestions = buildErrorSuggestions("codex: command not found", "codex exec task");

  expect(suggestions).toContain("CODEX_CLI_COMMAND");
  expect(suggestions).toContain("codex.cmd");
});

test("buildErrorSuggestions detects EACCES error", () => {
  const suggestions = buildErrorSuggestions("EACCES: permission denied", "codex exec task");

  expect(suggestions).toContain("--sandbox workspace-write");
});

test("formatCodexTimeoutError includes timeoutMs", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: ["--skip-git-repo-check"],
    prompt: "Task",
    cwd: "C:\\MisProyectos\\MCP",
    timeoutMs: 300000
  };

  const message = formatCodexTimeoutError(input, "C:\\handoff\\dir", "C:\\handoff\\dir\\agent-response.json");

  expect(message).toContain("300000");
  expect(message).toContain("timed out");
});

test("formatCodexTimeoutError includes suggestion to increase timeout", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 300000
  };

  const message = formatCodexTimeoutError(input, "/tmp/handoff", "/tmp/handoff/response.json");

  expect(message).toContain("CODEX_AUTO_REPAIR_TIMEOUT_MS");
  expect(message).toContain("1800000");
});

test("formatCodexTimeoutError recommended timeout is never equal to current timeout", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 900000
  };

  const message = formatCodexTimeoutError(input, "/tmp/handoff", "/tmp/handoff/response.json");

  expect(message).toContain("900000ms");
  expect(message).toContain("1800000ms");
  expect(message).not.toMatch(/recommended: 900000ms.*current: 900000ms/);
});

test("formatCodexTimeoutError recommends at least double or 1800000ms", () => {
  const input1: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 300000
  };
  const msg1 = formatCodexTimeoutError(input1, "/tmp/handoff", "/tmp/handoff/response.json");
  expect(msg1).toContain("1800000ms");

  const input2: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 900000
  };
  const msg2 = formatCodexTimeoutError(input2, "/tmp/handoff", "/tmp/handoff/response.json");
  expect(msg2).toContain("1800000ms");
});

test("formatCodexTimeoutError includes handoffDir and responsePath", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 300000
  };

  const message = formatCodexTimeoutError(input, "C:\\artifacts\\handoff-123", "C:\\artifacts\\handoff-123\\agent-response.json");

  expect(message).toContain("C:\\artifacts\\handoff-123");
  expect(message).toContain("agent-response.json");
});

test("formatCodexTimeoutError includes manual command suggestion", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 300000
  };

  const message = formatCodexTimeoutError(input, "/tmp/handoff", "/tmp/handoff/response.json");

  expect(message).toContain("Run manually");
  expect(message).toContain("agent:validate");
});

test("formatCodexTimeoutError shows minutes in human-readable format", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 900000
  };

  const message = formatCodexTimeoutError(input, "/tmp/handoff", "/tmp/handoff/response.json");

  expect(message).toContain("15.0 minutes");
});
