import { test, expect } from "@playwright/test";
import { generateSpecFromPlan } from "../src/automations/spec-generator";
import { buildAppAutomationPaths } from "../src/automations/app-profile";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

const basePlan: ExecutionPlan = {
  version: "1.0",
  source: "manual",
  status: "validated",
  scenario: {
    source: "testrail",
    externalId: "C37616",
    caseId: 37616,
    title: "Generic validated automation"
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

function makeSpec(appSlug = "generic-app"): string {
  const appProfile = {
    appSlug,
    name: "Generic App",
    baseUrl: "https://example.test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const appPaths = buildAppAutomationPaths(appProfile, "test-automation");
  return generateSpecFromPlan(basePlan, "test-automation", appProfile, appPaths);
}

test("spec generated imports static dependencies", () => {
  const spec = makeSpec();
  expect(spec).toContain("import { test } from '@playwright/test';");
  expect(spec).toContain("import { config } from '../../../../src/config/env';");
  expect(spec).toContain("import { executeExecutionPlan } from '../../../../src/runner/execution-plan-executor';");
});

test("spec generated loads persisted app config", () => {
  const spec = makeSpec("profile-a");
  expect(spec).toContain("loadPromotedAppConfigSync");
  expect(spec).toContain("SPEC_APP_PROFILE = 'profile-a'");
  expect(spec).toContain("SPEC_APP_CONFIG_PATH");
  expect(spec).toContain("app.config.json");
});

test("spec generated resolves plan from app-specific directory", () => {
  const spec = makeSpec("profile-a");
  expect(spec).toContain("automations/apps/profile-a/plans/test-automation.plan.json");
  expect(spec).not.toContain("automations/plans/");
});

test("spec generated does not depend on APP_BASE_URL global at runtime", () => {
  const spec = makeSpec("profile-a");
  expect(spec).toContain("const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;");
  expect(spec).toContain("appBaseUrl: __runtimeConfig.app.baseUrl");
});

test("spec generated uses portable relative paths", () => {
  const spec = makeSpec("profile-a");
  expect(spec).not.toContain("C:\\");
  expect(spec).not.toContain("/home/");
  expect(spec).toContain("resolve(process.cwd(),");
});

test("spec generated does not print secrets", () => {
  const spec = makeSpec("profile-a");
  expect(spec).not.toContain("APP_PASSWORD");
  expect(spec).not.toContain("SECRET");
  expect(spec).not.toContain("TOKEN");
});
