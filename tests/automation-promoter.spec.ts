import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { promoteDiscoveryAutomation } from "../src/automations/automation-promoter";
import { loadAutomationIndex } from "../src/automations/automation-index";
import { findReusableAutomation } from "../src/automations/automation-reuse";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { RegistryObject } from "../src/types/object-registry.types";

const tmpRoot = path.resolve(".tmp-test-automation-promoter");

function makePlan(): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: {
      source: "testrail",
      externalId: "C30000",
      caseId: 30000,
      title: "Generic reusable automation"
    },
    requiredData: [],
    steps: [
      { index: 1, action: "navigate", target: "APP_BASE_URL" },
      { index: 2, action: "click", target: { strategy: "text", value: "Primary CTA", exact: false } }
    ],
    createdAt: new Date().toISOString()
  };
}

function makeObject(key: string, confidence: number): RegistryObject {
  return {
    key,
    name: key,
    type: "button",
    locator: { strategy: "text", value: key, exact: false },
    tags: ["promoted", "discovery", `confidence:${confidence.toFixed(2)}`]
  };
}

test.beforeEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(path.join(tmpRoot, "automations", "plans"), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, "tests", "generated"), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, "discovery"), { recursive: true });
});

test("automation promovida queda disponible para reuse", async () => {
  const cwd = process.cwd();
  process.chdir(tmpRoot);
  try {
    const entry = await promoteDiscoveryAutomation({
      plan: makePlan(),
      discoveryDir: path.join(tmpRoot, "discovery"),
      promotedObjects: [makeObject("button_primary_cta", 0.9)]
    });

    const index = await loadAutomationIndex(path.join(tmpRoot, "automations/index.json"));
    const match = findReusableAutomation(30001, "Generic reusable automation", index.automations);

    expect(entry.source).toBe("discovery");
    expect(match?.entry.id).toBe(entry.id);
  } finally {
    process.chdir(cwd);
  }
});

test("automation promovida guarda metadata de discovery", async () => {
  const cwd = process.cwd();
  process.chdir(tmpRoot);
  try {
    const entry = await promoteDiscoveryAutomation({
      plan: makePlan(),
      discoveryDir: path.join(tmpRoot, "discovery"),
      promotedObjects: [makeObject("button_primary_cta", 0.9), makeObject("button_secondary_cta", 0.8)]
    });

    expect(entry.metadata?.discoveryDir).toContain("discovery");
    expect(entry.metadata?.promotedObjects).toEqual(["button_primary_cta", "button_secondary_cta"]);
    expect(entry.metadata?.confidenceSummary?.promotedCount).toBe(2);
  } finally {
    process.chdir(cwd);
  }
});
