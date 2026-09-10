import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
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
const exactPlan = "automations/apps/project-a/sections/section-a/cases/c1001/plan.json";
const dynamicSpec = "automations/apps/project-b/sections/other-section/cases/c2002/case.spec.ts";
const dynamicPlan = "automations/apps/project-b/sections/other-section/cases/c2002/plan.json";
const fixturePaths = [exactSpec, exactPlan, dynamicSpec, dynamicPlan].map((value) => path.resolve(process.cwd(), value));
const standaloneSpec = [
  "import { test } from '@playwright/test';",
  "import { createPromotedSpecRuntime } from '../../../../src/runtime/promoted-spec-runtime';",
  "test('fixture', async ({ page }) => { await createPromotedSpecRuntime(page); });",
].join("\n");

function promotedOverrides(specPath: string, planPath: string, specText = standaloneSpec): Partial<PromotedAutomationIndexEntry> {
  const absoluteSpec = path.resolve(process.cwd(), specPath);
  return {
    specPath,
    planPath,
    pomStatus: "needs_manual_review",
    promotionPersisted: true,
    promotedSpecPath: absoluteSpec,
    promotedSpecHash: createHash("sha256").update(specText, "utf8").digest("hex"),
  } as Partial<PromotedAutomationIndexEntry>;
}

test.beforeAll(() => {
  for (const fixture of fixturePaths) fs.mkdirSync(path.dirname(fixture), { recursive: true });
  fs.writeFileSync(fixturePaths[0], standaloneSpec, "utf8");
  fs.writeFileSync(fixturePaths[1], JSON.stringify({ steps: [{ action: "click" }] }), "utf8");
  fs.writeFileSync(fixturePaths[2], standaloneSpec, "utf8");
  fs.writeFileSync(fixturePaths[3], JSON.stringify({ steps: [{ action: "click" }] }), "utf8");
});

test.afterAll(() => {
  for (const fixture of fixturePaths) {
    try { fs.rmSync(path.dirname(fixture), { recursive: true, force: true }); } catch { /* test cleanup */ }
  }
});

test("T1/T2: selects only the promoted case spec, excluding candidate.spec.ts", () => {
  const selected = resolvePromotedSpecTarget(
    [entry(exactSpec, promotedOverrides(exactSpec, exactPlan))],
    { app: "project-a", section: "section-a", caseId: "1001" },
    () => true,
  );
  expect(selected).toBe(path.resolve(process.cwd(), exactSpec));
  expect(selected).not.toContain("candidate.spec.ts");
});

test("T3: app and section resolution remains dynamic", () => {
  const selected = resolvePromotedSpecTarget(
    [entry(dynamicSpec, { caseId: 2002, appSlug: "project-b", appProfile: "project-b", ...promotedOverrides(dynamicSpec, dynamicPlan) })],
    { app: "project-b", section: "other-section", caseId: "2002" },
    () => true,
  );
  expect(selected).toContain("project-b");
  expect(selected).toContain("other-section");
});

test("T4/T5: missing or out-of-scope specs fail closed", () => {
  expect(resolvePromotedSpecTarget([entry(exactSpec, promotedOverrides(exactSpec, exactPlan))], { app: "project-a", section: "section-a", caseId: "1001" }, () => false)).toBeNull();
  expect(resolvePromotedSpecTarget([entry("automations/apps/project-b/sections/section-a/cases/c1001/case.spec.ts", { appSlug: "project-b", appProfile: "project-b" })], { app: "project-a", section: "section-a", caseId: "1001" }, () => true)).toBeNull();
});

test("T6: selected target is the exact case spec used by the execution log", () => {
  const selected = resolvePromotedSpecTarget([entry(exactSpec, promotedOverrides(exactSpec, exactPlan))], { app: "project-a", section: "section-a", caseId: "1001" }, () => true);
  expect(selected?.replace(/\\/g, "/")).toMatch(/\/cases\/c1001\/case\.spec\.ts$/);
});
