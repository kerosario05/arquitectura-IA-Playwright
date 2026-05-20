import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { promoteExecutionPlan } from "../src/automations/promote-plan";
import { loadAutomationIndex } from "../src/automations/automation-index";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { FullConfig } from "../src/types/env.types";

const tmpDir = path.resolve("./.tmp-test-promote");

function makePlan(overrides: {
  externalId?: string;
  caseId?: number;
  title?: string;
  status?: ExecutionPlan["status"];
} = {}): ExecutionPlan {
  const status: ExecutionPlan["status"] = overrides.status ?? "validated";
  return {
    version: "1.0",
    source: "manual",
    status,
    scenario: {
      source: "testrail",
      externalId: overrides.externalId,
      caseId: overrides.caseId,
      title: overrides.title ?? "Generic automation"
    },
    requiredData: [],
    steps: [
      {
        index: 1,
        action: "navigate",
        target: "APP_BASE_URL"
      }
    ],
    createdAt: new Date().toISOString()
  };
}

function makeConfig(appProfile = "profile-a", baseUrl = "https://app-a.example.test"): FullConfig {
  return {
    app: {
      name: "Generic App",
      appProfile,
      baseUrl,
      loginMode: "password",
      username: "user-a",
      password: "pass-a",
      testData: { key1: "value1" },
      testDataAliases: { key1: ["alias1"] },
      missingInputBehavior: "fail"
    },
    execution: {
      browser: "chromium",
      headless: true,
      evidenceDir: ".artifacts/evidence",
      defaultTimeoutMs: 30000
    },
    integrations: {}
  };
}

test.beforeAll(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

test.afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test("promotes validated plan into app package", async () => {
  const plan = makePlan({ externalId: "C99999" });
  const entry = await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig() }, false);
  expect(entry.id).toBe("c99999-generic-automation");
  expect(entry.appSlug).toBe("profile-a");
  expect(entry.planPath).toContain("automations/apps/profile-a/plans/");
  expect(entry.specPath).toContain("automations/apps/profile-a/specs/");
});

test("plans:promote saves app.config.json", async () => {
  const plan = makePlan({ externalId: "C10000" });
  await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-b", "https://app-b.example.test") }, false);
  const configPath = path.join(tmpDir, "automations/apps/profile-b/app.config.json");
  const content = await fs.readFile(configPath, "utf-8");
  const parsed = JSON.parse(content);
  expect(parsed.appProfile.appSlug).toBe("profile-b");
  expect(parsed.baseUrl).toBe("https://app-b.example.test");
});

test("creates app-specific plan and spec files", async () => {
  const plan = makePlan({ externalId: "C10001" });
  await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-c") }, false);
  const planPath = path.join(tmpDir, "automations/apps/profile-c/plans/c10001-generic-automation.plan.json");
  const specPath = path.join(tmpDir, "automations/apps/profile-c/specs/c10001-generic-automation.spec.ts");
  await expect(fs.readFile(planPath, "utf-8")).resolves.toContain("\"version\": \"1.0\"");
  await expect(fs.readFile(specPath, "utf-8")).resolves.toContain("loadPromotedAppConfigSync");
});

test("updates per-app index and global index references", async () => {
  const plan = makePlan({ externalId: "C10002" });
  await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-d") }, false);
  const appIndex = await loadAutomationIndex(path.join(tmpDir, "automations/apps/profile-d/index.json"));
  const globalIndex = await loadAutomationIndex(path.join(tmpDir, "automations/index.json"));
  expect(appIndex.automations.some((a) => a.externalId === "C10002" && a.appSlug === "profile-d")).toBe(true);
  expect(globalIndex.automations.some((a) => a.externalId === "C10002" && a.appSlug === "profile-d")).toBe(true);
});

test("rejects non-promotable status", async () => {
  const plan = makePlan({ status: "needs_discovery" });
  await expect(promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-e") }, false)).rejects.toThrow(/not eligible/i);
});
