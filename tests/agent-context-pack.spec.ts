import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { buildAgentContextPack } from "../src/agent/agent-context-pack";
import type { FullConfig } from "../src/types/env.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import { getTestTempDir, ensureTestTempDir, cleanTestTempDir } from "./helpers/test-temp-dir";

const tmpDir = getTestTempDir("test-agent-context-pack");

function baseConfig(overrides?: Partial<FullConfig>): FullConfig {
  return {
    app: {
      baseUrl: "https://example.com",
      loginMode: "no_login",
      testData: { non_sensitive_key: "x" },
      testDataAliases: {},
      missingInputBehavior: "fail",
      appProfile: "default",
      password: "SUPER_SECRET_PASSWORD_SHOULD_NOT_APPEAR"
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
        autoRepairTimeoutMs: 5000,
        autoRepairPromptMode: "compact"
      }
    },
    ...overrides
  };
}

test.beforeAll(async () => {
  await ensureTestTempDir("test-agent-context-pack");
});

test.afterAll(async () => {
  try {
    await cleanTestTempDir("test-agent-context-pack");
  } catch {
  }
});

test("buildAgentContextPack includes appSlug, failure, and currentRun paths", async () => {
  const outDir = path.join(tmpDir, "run1");
  const evidenceDir = path.join(outDir, "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });

  const pendingObjectsPath = path.join(outDir, "discovered-objects.pending.json");
  await fs.writeFile(pendingObjectsPath, JSON.stringify([
    { key: "button_continue", name: "Continue", type: "button", locator: { strategy: "role", role: "button", name: "Continue" }, aliases: ["continue"], discoveredAt: "", sourceStep: 1, confidence: 0.9 },
    { key: "button_irrelevant", name: "Settings", type: "button", locator: { strategy: "text", value: "Settings" }, aliases: ["settings"], discoveredAt: "", sourceStep: 1, confidence: 0.9 }
  ], null, 2), "utf-8");

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, title: "Test Case" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "role", role: "button", name: "Continue" } }],
    createdAt: new Date().toISOString()
  };

  const { pack } = await buildAgentContextPack({
    fullConfig: baseConfig(),
    outputDir: outDir,
    evidenceDir,
    candidatePlanPath: path.join(outDir, "candidate-plan.json"),
    currentPlan: plan,
    pendingObjectsPath,
    failedReason: "target_not_found",
    failedTarget: "Continue",
    failedAtStep: 1,
    supportedActions: ["click", "fill"]
  });

  expect(pack.version).toBe("1.0");
  expect(pack.app.appSlug).toBe("default");
  expect(pack.failure.failedReason).toBe("target_not_found");
  expect(pack.failure.failedTarget).toBe("Continue");
  expect(pack.currentRun.outputDir).toContain(outDir);
  expect(pack.currentRun.pendingObjectsPath).toContain("discovered-objects.pending.json");
  expect(pack.knownObjects[0].name).toBe("Continue");
});

test("buildAgentContextPack redacts secrets and lists only safe data keys", async () => {
  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, title: "Test Case" },
    requiredData: [],
    steps: [],
    createdAt: new Date().toISOString()
  };

  const { pack } = await buildAgentContextPack({
    fullConfig: baseConfig(),
    outputDir: tmpDir,
    currentPlan: plan,
    failedReason: "ambiguous_target",
    failedTarget: "Login",
    supportedActions: ["click"]
  });

  const serialized = JSON.stringify(pack);
  expect(serialized).not.toContain("SUPER_SECRET_PASSWORD_SHOULD_NOT_APPEAR");
  expect(pack.safeData.redacted).toBe(true);
  expect(Array.isArray(pack.safeData.availableKeys)).toBe(true);
});

test("buildAgentContextPack limits maxObjects and records warning", async () => {
  const outDir = path.join(tmpDir, "run2");
  await fs.mkdir(outDir, { recursive: true });
  const pendingObjectsPath = path.join(outDir, "discovered-objects.pending.json");
  const many = Array.from({ length: 80 }).map((_, i) => ({
    key: `button_${i}`,
    name: `Button ${i}`,
    type: "button",
    locator: { strategy: "text", value: `Button ${i}`, exact: false },
    aliases: [`button ${i}`],
    discoveredAt: "",
    sourceStep: 1,
    confidence: 0.6
  }));
  await fs.writeFile(pendingObjectsPath, JSON.stringify(many, null, 2), "utf-8");

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, title: "Test Case" },
    requiredData: [],
    steps: [],
    createdAt: new Date().toISOString()
  };

  const { pack } = await buildAgentContextPack({
    fullConfig: baseConfig(),
    outputDir: outDir,
    currentPlan: plan,
    pendingObjectsPath,
    failedTarget: "Button",
    supportedActions: ["click"],
    options: { maxObjects: 50 }
  });

  expect(pack.knownObjects.length).toBe(50);
  expect(pack.warnings.join(" ")).toContain("knownObjects limited");
});
