import { test, expect } from "@playwright/test";
import path from "node:path";
import { resolvePromotedSpecTarget } from "../src/cli/test-promoted";
import type { PromotedAutomationIndexEntry } from "../src/types/automation-promotion.types";

function entry(specPath: string, overrides: Partial<PromotedAutomationIndexEntry> = {}): PromotedAutomationIndexEntry {
  return {
    id: "automation-case",
    caseId: 1001,
    title: "case",
    appSlug: "project-a",
    appProfile: "project-a",
    specPath,
    planPath: "plan.json",
    status: "active",
    source: "discovery",
    pomStatus: "promoted",
    specVerificationStatus: "passed",
    ...overrides,
  } as PromotedAutomationIndexEntry;
}

const exactSpec = "automations/apps/project-a/sections/section-a/cases/c1001/case.spec.ts";

test("T1/T2: selects only the promoted case spec, excluding candidate.spec.ts", () => {
  const selected = resolvePromotedSpecTarget(
    [entry(exactSpec)],
    { app: "project-a", section: "section-a", caseId: "1001" },
    () => true,
  );
  expect(selected).toBe(path.resolve(process.cwd(), exactSpec));
  expect(selected).not.toContain("candidate.spec.ts");
});

test("T3: app and section resolution remains dynamic", () => {
  const selected = resolvePromotedSpecTarget(
    [entry("automations/apps/project-b/sections/other-section/cases/c2002/case.spec.ts", { caseId: 2002, appSlug: "project-b", appProfile: "project-b" })],
    { app: "project-b", section: "other-section", caseId: "2002" },
    () => true,
  );
  expect(selected).toContain("project-b");
  expect(selected).toContain("other-section");
});

test("T4/T5: missing or out-of-scope specs fail closed", () => {
  expect(resolvePromotedSpecTarget([entry(exactSpec)], { app: "project-a", section: "section-a", caseId: "1001" }, () => false)).toBeNull();
  expect(resolvePromotedSpecTarget([entry("automations/apps/project-b/sections/section-a/cases/c1001/case.spec.ts", { appSlug: "project-b", appProfile: "project-b" })], { app: "project-a", section: "section-a", caseId: "1001" }, () => true)).toBeNull();
});

test("T6: selected target is the exact case spec used by the execution log", () => {
  const selected = resolvePromotedSpecTarget([entry(exactSpec)], { app: "project-a", section: "section-a", caseId: "1001" }, () => true);
  expect(selected?.replace(/\\/g, "/")).toMatch(/\/cases\/c1001\/case\.spec\.ts$/);
});
