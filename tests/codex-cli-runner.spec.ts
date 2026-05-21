import { test, expect } from "@playwright/test";
import { buildCommand, formatCodexCliError, formatCodexTimeoutError, escapeDoubleQuotes, buildErrorSuggestions, runCodexCli, __setSpawnForTesting, __setPlatformForTesting, needsCmdExe, resolveSpawnCommand } from "../src/agent/codex-cli-runner";
import type { CodexCliRunnerInput, CodexCliRunnerResult } from "../src/types/codex-auto-repair.types";
import { EventEmitter } from "node:events";

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
    timedOut: false,
    durationMs: 10
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
    timedOut: false,
    durationMs: 10
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
    timedOut: false,
    durationMs: 10
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
    signal: "SIGTERM",
    durationMs: 10
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
    timedOut: false,
    durationMs: 10
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
    timedOut: false,
    durationMs: 10
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
    timedOut: false,
    durationMs: 10
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
    timedOut: false,
    durationMs: 10
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

// --- Windows cmd.exe resolution tests ---

test("needsCmdExe returns true for .cmd on win32", () => {
  expect(needsCmdExe("codex.cmd", "win32")).toBe(true);
  expect(needsCmdExe("C:\\npm\\codex.cmd", "win32")).toBe(true);
});

test("needsCmdExe returns true for .bat on win32", () => {
  expect(needsCmdExe("runner.bat", "win32")).toBe(true);
});

test("needsCmdExe returns false for plain command on win32", () => {
  expect(needsCmdExe("codex", "win32")).toBe(false);
  expect(needsCmdExe("node", "win32")).toBe(false);
});

test("needsCmdExe returns false on non-win32 regardless of extension", () => {
  expect(needsCmdExe("codex.cmd", "linux")).toBe(false);
  expect(needsCmdExe("codex.bat", "darwin")).toBe(false);
  expect(needsCmdExe("codex", "linux")).toBe(false);
});

test("needsCmdExe defaults to currentPlatform seam", () => {
  __setPlatformForTesting("win32");
  try {
    expect(needsCmdExe("codex.cmd")).toBe(true);
    expect(needsCmdExe("codex")).toBe(false);
  } finally {
    __setPlatformForTesting(undefined);
  }
});

test("resolveSpawnCommand wraps .cmd in cmd.exe on win32", () => {
  const input: CodexCliRunnerInput = {
    command: "C:\\Users\\radames\\AppData\\Roaming\\npm\\codex.cmd",
    extraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"],
    prompt: "Read context-pack.json and fix targets",
    cwd: "C:\\MisProyectos\\MCP",
    timeoutMs: 5000
  };

  const resolved = resolveSpawnCommand(input, "win32");
  expect(resolved.spawnCommand).toBe("cmd.exe");
  expect(resolved.spawnArgs[0]).toBe("/d");
  expect(resolved.spawnArgs[1]).toBe("/s");
  expect(resolved.spawnArgs[2]).toBe("/c");
  expect(resolved.spawnArgs[3]).toContain("codex.cmd");
  expect(resolved.spawnArgs).toContain("--skip-git-repo-check");
  expect(resolved.spawnArgs).toContain("--sandbox");
  expect(resolved.spawnArgs).toContain("workspace-write");
  expect(resolved.spawnArgs).toContain("Read context-pack.json and fix targets");
});

test("resolveSpawnCommand does not wrap plain command on win32", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };

  const resolved = resolveSpawnCommand(input, "win32");
  expect(resolved.spawnCommand).toBe("codex");
  expect(resolved.spawnArgs[0]).toBe("exec");
  expect(resolved.spawnArgs[1]).toBe("Task");
  expect(resolved.spawnCommand).not.toBe("cmd.exe");
});

test("resolveSpawnCommand does not wrap on linux even with .cmd", () => {
  const input: CodexCliRunnerInput = {
    command: "codex.cmd",
    extraArgs: [],
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 5000
  };

  const resolved = resolveSpawnCommand(input, "linux");
  expect(resolved.spawnCommand).toBe("codex.cmd");
  expect(resolved.spawnCommand).not.toBe("cmd.exe");
});

test("resolveSpawnCommand displayCommand matches buildCommand output", () => {
  const input: CodexCliRunnerInput = {
    command: "codex",
    extraArgs: ["--skip-git-repo-check"],
    prompt: "Fix the issue",
    cwd: process.cwd(),
    timeoutMs: 5000
  };

  const resolved = resolveSpawnCommand(input, "win32");
  expect(resolved.displayCommand).toBe(buildCommand(input));
  expect(resolved.displayCommand).toContain("codex");
  expect(resolved.displayCommand).toContain("Fix the issue");
});

test("runCodexCli spawns cmd.exe for codex.cmd on win32", async () => {
  __setPlatformForTesting("win32");
  let capturedCommand: string | undefined;
  let capturedArgs: string[] | undefined;
  let capturedStdio: unknown;

  __setSpawnForTesting(((cmd: string, args: string[], opts: any) => {
    capturedCommand = cmd;
    capturedArgs = args;
    capturedStdio = opts.stdio;
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit("close", 0, null), 10);
    return child;
  }) as any);

  try {
    const input: CodexCliRunnerInput = {
      command: "C:\\npm\\codex.cmd",
      extraArgs: [],
      prompt: "win32 test",
      cwd: process.cwd(),
      timeoutMs: 5000
    };

    await runCodexCli(input);
    expect(capturedCommand).toBe("cmd.exe");
    expect(capturedArgs?.[0]).toBe("/d");
    expect(capturedArgs?.[1]).toBe("/s");
    expect(capturedArgs?.[2]).toBe("/c");
    expect(capturedArgs?.[3]).toContain("codex.cmd");
    expect(capturedStdio).toEqual(["ignore", "pipe", "pipe"]);
  } finally {
    __setPlatformForTesting(undefined);
    __setSpawnForTesting(undefined as any);
  }
});

test("runCodexCli spawns command directly on non-win32", async () => {
  __setPlatformForTesting("linux");
  let capturedCommand: string | undefined;
  let capturedStdio: unknown;

  __setSpawnForTesting(((cmd: string, _args: string[], opts: any) => {
    capturedCommand = cmd;
    capturedStdio = opts.stdio;
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit("close", 0, null), 10);
    return child;
  }) as any);

  try {
    const input: CodexCliRunnerInput = {
      command: "codex",
      extraArgs: [],
      prompt: "linux test",
      cwd: process.cwd(),
      timeoutMs: 5000
    };

    await runCodexCli(input);
    expect(capturedCommand).toBe("codex");
    expect(capturedStdio).toEqual(["ignore", "pipe", "pipe"]);
  } finally {
    __setPlatformForTesting(undefined);
    __setSpawnForTesting(undefined as any);
  }
});

test("runCodexCli heartbeat still works after spawn resolution change", async () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown, ...rest: unknown[]) => {
    logs.push([String(msg ?? ""), ...rest.map(String)].join(" "));
  };

  try {
    __setSpawnForTesting(((cmd: string, args: string[], opts: any) => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit("close", 0, null), 120);
      return child;
    }) as any);

    const input: CodexCliRunnerInput = {
      command: "codex",
      extraArgs: [],
      prompt: "Task",
      cwd: process.cwd(),
      timeoutMs: 5000,
      heartbeatMs: 50,
      attempt: 1,
      handoffDir: process.cwd(),
      showAgentLog: false
    };

    await runCodexCli(input);
    expect(logs.some((l) => l.includes("Codex still running"))).toBe(true);
  } finally {
    console.log = orig;
  }
});

test("runCodexCli showAgentLog includes spawnCommand on win32", async () => {
  __setPlatformForTesting("win32");
  const logs: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown, ...rest: unknown[]) => {
    logs.push([String(msg ?? ""), ...rest.map(String)].join(" "));
  };

  try {
    __setSpawnForTesting(((cmd: string, args: string[], opts: any) => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit("close", 0, null), 10);
      return child;
    }) as any);

    const input: CodexCliRunnerInput = {
      command: "C:\\npm\\codex.cmd",
      extraArgs: [],
      prompt: "test",
      cwd: process.cwd(),
      timeoutMs: 5000,
      showAgentLog: true
    };

    await runCodexCli(input);
    expect(logs.some((l) => l.includes("displayCommand:"))).toBe(true);
    expect(logs.some((l) => l.includes("spawnCommand:"))).toBe(true);
    expect(logs.some((l) => l.includes("cmd.exe"))).toBe(true);
  } finally {
    __setPlatformForTesting(undefined);
    __setSpawnForTesting(undefined as any);
    console.log = orig;
  }
});

test("runCodexCli emits heartbeat when no output", async () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown, ...rest: unknown[]) => {
    logs.push([String(msg ?? ""), ...rest.map(String)].join(" "));
  };

  try {
    __setSpawnForTesting(((command: string, args: string[], options: any) => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { /* noop */ };
      // No output, close after a short delay.
      setTimeout(() => child.emit("close", 0, null), 120);
      return child;
    }) as any);

    const input: CodexCliRunnerInput = {
      command: "codex",
      extraArgs: [],
      prompt: "Task",
      cwd: process.cwd(),
      timeoutMs: 5000,
      heartbeatMs: 50,
      attempt: 1,
      handoffDir: process.cwd(),
      showAgentLog: false
    };

    await runCodexCli(input);
    expect(logs.some((l) => l.includes("Codex still running"))).toBe(true);
  } finally {
    console.log = orig;
  }
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
