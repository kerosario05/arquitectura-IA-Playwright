import { test, expect } from "@playwright/test";
import { getCaseAutomationStatus } from "../src/cases/case-automation-status";
import type { RawTestRailCase } from "../src/types/testrail.types";
import type { PromotedAutomationIndexEntry } from "../src/types/automation-promotion.types";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function createMockCases(count: number): RawTestRailCase[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    title: `Test Case ${i + 1}`,
    section_id: 4717
  }));
}

function createEntry(overrides?: Partial<PromotedAutomationIndexEntry>): PromotedAutomationIndexEntry {
  return {
    id: "auto-1",
    caseId: 1000,
    title: "Test Case 1",
    planPath: "plans/plan-1.json",
    specPath: "tests/test-1.spec.ts",
    status: "active",
    source: "rule_based",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

async function createTempIndex(entries: PromotedAutomationIndexEntry[]): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "case-status-test-"));
  const indexPath = path.join(tmpDir, "index.json");
  await fs.writeFile(
    indexPath,
    JSON.stringify({ version: "1.0", updatedAt: new Date().toISOString(), automations: entries }, null, 2),
    "utf-8"
  );
  return indexPath;
}

test("returns not_automated for cases without index entries", async () => {
  const cases = createMockCases(2);
  const indexPath = await createTempIndex([]);

  const result = await getCaseAutomationStatus(cases, indexPath);

  expect(result.totalCount).toBe(2);
  expect(result.automatedCount).toBe(0);
  expect(result.notAutomatedCount).toBe(2);
  expect(result.cases[0].automationStatus).toBe("not_automated");
  expect(result.cases[1].automationStatus).toBe("not_automated");
});

test("returns active status for cases with active automation entries", async () => {
  const cases = createMockCases(2);
  const indexPath = await createTempIndex([
    {
      id: "auto-1",
      caseId: 1000,
      title: "Test Case 1",
      planPath: "plans/plan-1.json",
      specPath: "tests/test-1.spec.ts",
      status: "active",
      source: "rule_based",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);

  const result = await getCaseAutomationStatus(cases, indexPath);

  expect(result.automatedCount).toBe(1);
  expect(result.notAutomatedCount).toBe(1);
  expect(result.cases[0].automationStatus).toBe("active");
  expect(result.cases[1].automationStatus).toBe("not_automated");
});

test("includes specPath and planPath from automation index", async () => {
  const cases = createMockCases(1);
  const indexPath = await createTempIndex([
    {
      id: "auto-1",
      caseId: 1000,
      title: "Test Case 1",
      planPath: "automations/plans/plan-1000.plan.json",
      specPath: "tests/generated/test-1000.spec.ts",
      status: "active",
      source: "rule_based",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);

  const result = await getCaseAutomationStatus(cases, indexPath);

  expect(result.cases[0].planPath).toBe("automations/plans/plan-1000.plan.json");
  expect(result.cases[0].specPath).toBe("tests/generated/test-1000.spec.ts");
});

test("handles draft and disabled statuses correctly", async () => {
  const cases = createMockCases(3);
  const indexPath = await createTempIndex([
    {
      id: "auto-1",
      caseId: 1000,
      title: "Test Case 1",
      planPath: "plans/plan-1.json",
      specPath: "tests/test-1.spec.ts",
      status: "draft",
      source: "rule_based",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "auto-2",
      caseId: 1001,
      title: "Test Case 2",
      planPath: "plans/plan-2.json",
      specPath: "tests/test-2.spec.ts",
      status: "disabled",
      source: "rule_based",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);

  const result = await getCaseAutomationStatus(cases, indexPath);

  expect(result.cases[0].automationStatus).toBe("draft");
  expect(result.cases[1].automationStatus).toBe("disabled");
  expect(result.cases[2].automationStatus).toBe("not_automated");
});

test("returns empty list when no cases provided", async () => {
  const indexPath = await createTempIndex([]);
  const result = await getCaseAutomationStatus([], indexPath);

  expect(result.totalCount).toBe(0);
  expect(result.automatedCount).toBe(0);
  expect(result.notAutomatedCount).toBe(0);
  expect(result.cases).toEqual([]);
});

test("returns different_profile when entry appProfile does not match current APP_PROFILE", async () => {
  const cases = createMockCases(1);
  const indexPath = await createTempIndex([
    createEntry({ caseId: 1000, appProfile: "kiosko" })
  ]);
  process.env.APP_PROFILE = "saucedemo";

  try {
    const result = await getCaseAutomationStatus(cases, indexPath);
    expect(result.cases[0].automationStatus).toBe("different_profile");
    expect(result.cases[0].appProfile).toBe("kiosko");
    expect(result.cases[0].currentProfile).toBe("saucedemo");
  } finally {
    delete process.env.APP_PROFILE;
  }
});

test("returns active when entry appProfile matches current APP_PROFILE", async () => {
  const cases = createMockCases(1);
  const indexPath = await createTempIndex([
    createEntry({ caseId: 1000, appProfile: "saucedemo" })
  ]);
  process.env.APP_PROFILE = "saucedemo";

  try {
    const result = await getCaseAutomationStatus(cases, indexPath);
    expect(result.cases[0].automationStatus).toBe("active");
  } finally {
    delete process.env.APP_PROFILE;
  }
});

test("returns active for legacy entry without appProfile when no APP_PROFILE set", async () => {
  const cases = createMockCases(1);
  const indexPath = await createTempIndex([
    createEntry({ caseId: 1000, appProfile: undefined })
  ]);
  delete process.env.APP_PROFILE;

  const result = await getCaseAutomationStatus(cases, indexPath);
  expect(result.cases[0].automationStatus).toBe("active");
});

test("returns different_profile for legacy entry without appProfile when APP_PROFILE is set to non-default", async () => {
  const cases = createMockCases(1);
  const indexPath = await createTempIndex([
    createEntry({ caseId: 1000, appProfile: undefined })
  ]);
  process.env.APP_PROFILE = "kiosko";

  try {
    const result = await getCaseAutomationStatus(cases, indexPath);
    expect(result.cases[0].automationStatus).toBe("different_profile");
  } finally {
    delete process.env.APP_PROFILE;
  }
});
