import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { __setSpawnForTesting } from "../src/agent/codex-cli-runner";
import { runAgentAutoRepairAttempt } from "../src/agent/agent-auto-repair";
import type { FullConfig } from "../src/types/env.types";
import { EventEmitter } from "node:events";
import type { ExecOptions } from "node:child_process";

const tmpDir = path.resolve("./.tmp-test-agent-auto-repair-context-pack");

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

function configWithAgentEnabled(): FullConfig {
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
      ai: { discoveryMaxAttempts: 1 },
      agent: {
        provider: "codex",
        autoRepairEnabled: true,
        command: "codex",
        extraArgs: "--skip-git-repo-check",
        autoRepairTimeoutMs: 1000,
        autoRepairPromptMode: "compact"
      }
    }
  };
}

test.beforeAll(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

test.afterAll(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
  }
});

test("auto-repair creates context-pack.json and request references it", async () => {
  __setSpawnForTesting(mockSpawnExit({ exitCode: 1, stderr: "mock failure" }));

  const outputDir = path.join(tmpDir, "run1");
  await fs.mkdir(outputDir, { recursive: true });

  const result = await runAgentAutoRepairAttempt({
    fullConfig: configWithAgentEnabled(),
    outputDir,
    attemptNumber: 1,
    kind: "plan_repair",
    failureSummary: "target_not_found",
    failedReason: "target_not_found",
    failedTarget: "Continue",
    failedAtStep: 1
  });

  const handoffDir = path.join(outputDir, "handoff-attempt-1");
  const contextPath = path.join(handoffDir, "context-pack.json");
  const requestPath = path.join(handoffDir, "handoff-request.json");

  const contextExists = await fs.stat(contextPath).then(() => true).catch(() => false);
  expect(contextExists).toBe(true);

  const req = await fs.readFile(requestPath, "utf-8");
  expect(req).toContain("contextPackPath");
  expect(req).toContain("context-pack.json");

  expect(result.attempted).toBe(true);
});
