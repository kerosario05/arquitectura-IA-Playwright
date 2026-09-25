"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
const test_promoted_1 = require("../src/cli/test-promoted");
function entry(specPath, overrides = {}) {
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
    };
}
const exactSpec = "automations/apps/project-a/sections/section-a/cases/c1001/case.spec.ts";
const exactPlan = "automations/apps/project-a/sections/section-a/cases/c1001/plan.json";
const dynamicSpec = "automations/apps/project-b/sections/other-section/cases/c2002/case.spec.ts";
const dynamicPlan = "automations/apps/project-b/sections/other-section/cases/c2002/plan.json";
const fixturePaths = [exactSpec, exactPlan, dynamicSpec, dynamicPlan].map((value) => node_path_1.default.resolve(process.cwd(), value));
const standaloneSpec = [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from '../../../../src/runtime/promoted-spec-runtime';",
    "test('fixture', async ({ page }) => { await createPromotedSpecRuntime(page); });",
].join("\n");
function promotedOverrides(specPath, planPath, specText = standaloneSpec) {
    const absoluteSpec = node_path_1.default.resolve(process.cwd(), specPath);
    return {
        specPath,
        planPath,
        pomStatus: "needs_manual_review",
        promotionPersisted: true,
        promotedSpecPath: absoluteSpec,
        promotedSpecHash: (0, node_crypto_1.createHash)("sha256").update(specText, "utf8").digest("hex"),
    };
}
test_1.test.beforeAll(() => {
    for (const fixture of fixturePaths)
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(fixture), { recursive: true });
    node_fs_1.default.writeFileSync(fixturePaths[0], standaloneSpec, "utf8");
    node_fs_1.default.writeFileSync(fixturePaths[1], JSON.stringify({ steps: [{ action: "click" }] }), "utf8");
    node_fs_1.default.writeFileSync(fixturePaths[2], standaloneSpec, "utf8");
    node_fs_1.default.writeFileSync(fixturePaths[3], JSON.stringify({ steps: [{ action: "click" }] }), "utf8");
});
test_1.test.afterAll(() => {
    for (const fixture of fixturePaths) {
        try {
            node_fs_1.default.rmSync(node_path_1.default.dirname(fixture), { recursive: true, force: true });
        }
        catch { /* test cleanup */ }
    }
});
(0, test_1.test)("T1/T2: selects only the promoted case spec, excluding candidate.spec.ts", () => {
    const selected = (0, test_promoted_1.resolvePromotedSpecTarget)([entry(exactSpec, promotedOverrides(exactSpec, exactPlan))], { app: "project-a", section: "section-a", caseId: "1001" }, () => true);
    (0, test_1.expect)(selected).toBe(node_path_1.default.resolve(process.cwd(), exactSpec));
    (0, test_1.expect)(selected).not.toContain("candidate.spec.ts");
});
(0, test_1.test)("T3: app and section resolution remains dynamic", () => {
    const selected = (0, test_promoted_1.resolvePromotedSpecTarget)([entry(dynamicSpec, { caseId: 2002, appSlug: "project-b", appProfile: "project-b", ...promotedOverrides(dynamicSpec, dynamicPlan) })], { app: "project-b", section: "other-section", caseId: "2002" }, () => true);
    (0, test_1.expect)(selected).toContain("project-b");
    (0, test_1.expect)(selected).toContain("other-section");
});
(0, test_1.test)("T4/T5: missing or out-of-scope specs fail closed", () => {
    (0, test_1.expect)((0, test_promoted_1.resolvePromotedSpecTarget)([entry(exactSpec, promotedOverrides(exactSpec, exactPlan))], { app: "project-a", section: "section-a", caseId: "1001" }, () => false)).toBeNull();
    (0, test_1.expect)((0, test_promoted_1.resolvePromotedSpecTarget)([entry("automations/apps/project-b/sections/section-a/cases/c1001/case.spec.ts", { appSlug: "project-b", appProfile: "project-b" })], { app: "project-a", section: "section-a", caseId: "1001" }, () => true)).toBeNull();
});
(0, test_1.test)("T6: selected target is the exact case spec used by the execution log", () => {
    const selected = (0, test_promoted_1.resolvePromotedSpecTarget)([entry(exactSpec, promotedOverrides(exactSpec, exactPlan))], { app: "project-a", section: "section-a", caseId: "1001" }, () => true);
    (0, test_1.expect)(selected?.replace(/\\/g, "/")).toMatch(/\/cases\/c1001\/case\.spec\.ts$/);
});
