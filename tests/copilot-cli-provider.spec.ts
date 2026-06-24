import { test, expect } from "@playwright/test";
import { CopilotCliProvider, __setSpawnForTesting } from "../src/ai/providers/copilot-cli-provider";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as path from "node:path";

class MockChildProcess extends EventEmitter implements Partial<ChildProcess> {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill() {}
}

test("copilot-cli with long prompt creates prompt.txt", async () => {
  let capturedCwd: string | undefined;
  let capturedArgs: string[] = [];
  let promptFileWasWritten = false;

  const mockSpawn = (cmd: string, args: string[], options?: any) => {
    capturedCwd = options?.cwd;
    capturedArgs = args;

    // Check if prompt.txt exists in cwd
    if (capturedCwd) {
      const promptPath = path.join(capturedCwd, "prompt.txt");
      fs.access(promptPath).then(() => {
        promptFileWasWritten = true;
      }).catch(() => {
        // File might not exist yet
      });
    }

    const child = new MockChildProcess() as any;
    setTimeout(() => {
      // After spawn is called, check again if file exists
      if (capturedCwd && !promptFileWasWritten) {
        const promptPath = path.join(capturedCwd, "prompt.txt");
        fs.access(promptPath).then(() => {
          promptFileWasWritten = true;
        }).catch(() => {
          // File might still not exist
        });
      }
      child.stdout.emit("data", Buffer.from('{"ok":true}'));
      child.emit("close", 0);
    }, 10);

    return child;
  };

  __setSpawnForTesting(mockSpawn);

  const provider = new CopilotCliProvider({
    enabled: true,
    provider: "copilot_cli",
    providerName: "copilot",
    baseUrl: "",
    apiKey: "",
    model: "claude-haiku-4.5",
    timeoutMs: 5000,
    requireJson: true,
    requireJsonSchema: false,
    command: "copilot",
    extraArgs: []
  });

  const longSystemMessage = "X".repeat(17653);
  const longUserMessage = "Y".repeat(2231);

  const response = await provider.completeJson({
    purpose: "test",
    messages: [
      { role: "system", content: longSystemMessage },
      { role: "user", content: longUserMessage }
    ]
  });

  expect(response.parsedJson).toEqual({ ok: true });

  // Verify short prompt is passed, not the full long one
  const promptArg = capturedArgs[capturedArgs.indexOf("-p") + 1];
  expect(promptArg).toBeDefined();
  expect(promptArg?.length).toBeLessThan(500); // Short prompt
  expect(promptArg).toContain("prompt.txt");
  expect(promptArg).not.toContain("X".repeat(100)); // Not the long system message

  // Verify cwd is set
  expect(capturedCwd).toBeDefined();
  expect(capturedCwd).toContain(".artifacts");

  // Verify model and flags are correct
  expect(capturedArgs.join(" ")).toContain("--model");
  expect(capturedArgs.join(" ")).toContain("claude-haiku-4.5");
  expect(capturedArgs.join(" ")).toContain("--no-ask-user");
  expect(capturedArgs.join(" ")).toContain("-s");
});

test("copilot-cli uses cmd.exe on Windows .cmd files", async () => {
  let spawnCmd: string | undefined;
  let spawnArgs: string[] = [];
  let spawnOptions: any;

  const mockSpawn = (cmd: string, args: string[], options?: any) => {
    spawnCmd = cmd;
    spawnArgs = args;
    spawnOptions = options;

    const child = new MockChildProcess() as any;
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from('{"ok":true}'));
      child.emit("close", 0);
    }, 10);
    return child;
  };

  __setSpawnForTesting(mockSpawn);

  // Mock Windows platform
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });

  try {
    const provider = new CopilotCliProvider({
      enabled: true,
      provider: "copilot_cli",
      providerName: "copilot",
      baseUrl: "",
      apiKey: "",
      model: "claude-haiku-4.5",
      timeoutMs: 5000,
      requireJson: true,
      requireJsonSchema: false,
      command: "C:\\path\\to\\copilot.cmd",
      extraArgs: []
    });

    await provider.completeJson({
      purpose: "test",
      messages: [{ role: "user", content: "test" }]
    });

    // Verify cmd.exe is used
    expect(spawnCmd).toBe("cmd.exe");
    expect(spawnArgs[0]).toBe("/d");
    expect(spawnArgs[1]).toBe("/s");
    expect(spawnArgs[2]).toBe("/c");
    expect(spawnArgs[3]).toContain("copilot.cmd");
    // Verify -p and the short prompt are preserved as separate args
    expect(spawnArgs).toContain("-p");
    expect(spawnArgs).toContain("--model");
    expect(spawnArgs).toContain("claude-haiku-4.5");
    // Verify windowsHide is set
    expect(spawnOptions?.windowsHide).toBe(true);
    expect(spawnOptions?.cwd).toBeDefined();
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  }
});

test("copilot-cli handles non-zero exit code", async () => {
  const mockSpawn = () => {
    const child = new MockChildProcess() as any;
    setTimeout(() => {
      child.stderr.emit("data", Buffer.from("The command line is too long."));
      child.emit("close", 1);
    }, 10);
    return child;
  };

  __setSpawnForTesting(mockSpawn);

  const provider = new CopilotCliProvider({
    enabled: true,
    provider: "copilot_cli",
    providerName: "copilot",
    baseUrl: "",
    apiKey: "",
    model: "claude-haiku-4.5",
    timeoutMs: 5000,
    requireJson: true,
    requireJsonSchema: false,
    command: "copilot"
  });

  await expect(
    provider.completeJson({
      purpose: "scenario_generation",
      messages: [{ role: "user", content: "test" }]
    })
  ).rejects.toThrow(/copilot_cli_execution_failed|exited with code 1/);
});

test("copilot-cli handles empty output", async () => {
  const mockSpawn = () => {
    const child = new MockChildProcess() as any;
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from(""));
      child.emit("close", 0);
    }, 10);
    return child;
  };

  __setSpawnForTesting(mockSpawn);

  const provider = new CopilotCliProvider({
    enabled: true,
    provider: "copilot_cli",
    providerName: "copilot",
    baseUrl: "",
    apiKey: "",
    model: "claude-haiku-4.5",
    timeoutMs: 5000,
    requireJson: true,
    requireJsonSchema: false,
    command: "copilot"
  });

  await expect(
    provider.completeJson({
      purpose: "scenario_generation",
      messages: [{ role: "user", content: "test" }]
    })
  ).rejects.toThrow(/copilot_cli_empty_output|empty stdout/);
});
