"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const case_automation_status_1 = require("../src/cases/case-automation-status");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
function createMockCases(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: 1000 + i,
        title: `Test Case ${i + 1}`,
        section_id: 4717
    }));
}
function createEntry(overrides) {
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
async function createTempIndex(entries) {
    const tmpDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "case-status-test-"));
    const indexPath = node_path_1.default.join(tmpDir, "index.json");
    await promises_1.default.writeFile(indexPath, JSON.stringify({ version: "1.0", updatedAt: new Date().toISOString(), automations: entries }, null, 2), "utf-8");
    return indexPath;
}
(0, test_1.test)("returns not_automated for cases without index entries", async () => {
    const cases = createMockCases(2);
    const indexPath = await createTempIndex([]);
    const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
    (0, test_1.expect)(result.totalCount).toBe(2);
    (0, test_1.expect)(result.automatedCount).toBe(0);
    (0, test_1.expect)(result.notAutomatedCount).toBe(2);
    (0, test_1.expect)(result.cases[0].automationStatus).toBe("not_automated");
    (0, test_1.expect)(result.cases[1].automationStatus).toBe("not_automated");
});
(0, test_1.test)("returns active status for cases with active automation entries", async () => {
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
    const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
    (0, test_1.expect)(result.automatedCount).toBe(1);
    (0, test_1.expect)(result.notAutomatedCount).toBe(1);
    (0, test_1.expect)(result.cases[0].automationStatus).toBe("active");
    (0, test_1.expect)(result.cases[1].automationStatus).toBe("not_automated");
});
(0, test_1.test)("includes specPath and planPath from automation index", async () => {
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
    const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
    (0, test_1.expect)(result.cases[0].planPath).toBe("automations/plans/plan-1000.plan.json");
    (0, test_1.expect)(result.cases[0].specPath).toBe("tests/generated/test-1000.spec.ts");
});
(0, test_1.test)("handles draft and disabled statuses correctly", async () => {
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
    const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
    (0, test_1.expect)(result.cases[0].automationStatus).toBe("draft");
    (0, test_1.expect)(result.cases[1].automationStatus).toBe("disabled");
    (0, test_1.expect)(result.cases[2].automationStatus).toBe("not_automated");
});
(0, test_1.test)("returns empty list when no cases provided", async () => {
    const indexPath = await createTempIndex([]);
    const result = await (0, case_automation_status_1.getCaseAutomationStatus)([], indexPath);
    (0, test_1.expect)(result.totalCount).toBe(0);
    (0, test_1.expect)(result.automatedCount).toBe(0);
    (0, test_1.expect)(result.notAutomatedCount).toBe(0);
    (0, test_1.expect)(result.cases).toEqual([]);
});
(0, test_1.test)("returns different_profile when entry appProfile does not match current APP_PROFILE", async () => {
    const cases = createMockCases(1);
    const indexPath = await createTempIndex([
        createEntry({ caseId: 1000, appProfile: "kiosko" })
    ]);
    process.env.APP_PROFILE = "saucedemo";
    try {
        const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
        (0, test_1.expect)(result.cases[0].automationStatus).toBe("different_profile");
        (0, test_1.expect)(result.cases[0].appProfile).toBe("kiosko");
        (0, test_1.expect)(result.cases[0].currentProfile).toBe("saucedemo");
    }
    finally {
        delete process.env.APP_PROFILE;
    }
});
(0, test_1.test)("automation from another app is not ACTIVE in current profile", async () => {
    const cases = createMockCases(1);
    const indexPath = await createTempIndex([
        createEntry({ caseId: 1000, appSlug: "app-a", appProfile: "app-a" })
    ]);
    process.env.APP_PROFILE = "app-b";
    try {
        const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
        (0, test_1.expect)(result.cases[0].automationStatus).toBe("different_profile");
    }
    finally {
        delete process.env.APP_PROFILE;
    }
});
(0, test_1.test)("--all-apps style lookup can find app index entries", async () => {
    const tmpDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "case-status-all-apps-"));
    const globalIndexPath = node_path_1.default.join(tmpDir, "automations", "index.json");
    const appIndexDir = node_path_1.default.join(tmpDir, "automations", "apps", "app-a");
    await promises_1.default.mkdir(node_path_1.default.dirname(globalIndexPath), { recursive: true });
    await promises_1.default.mkdir(appIndexDir, { recursive: true });
    await promises_1.default.writeFile(globalIndexPath, JSON.stringify({ version: "1.0", updatedAt: "", automations: [] }, null, 2), "utf-8");
    await promises_1.default.writeFile(node_path_1.default.join(appIndexDir, "index.json"), JSON.stringify({
        version: "1.0",
        updatedAt: "",
        automations: [createEntry({ caseId: 1000, appSlug: "app-a", appProfile: "app-a" })]
    }, null, 2), "utf-8");
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
        const result = await (0, case_automation_status_1.getCaseAutomationStatus)(createMockCases(1), globalIndexPath, { allApps: true, currentProfile: "app-a" });
        (0, test_1.expect)(result.cases[0].automationStatus).toBe("active");
    }
    finally {
        process.chdir(originalCwd);
        await promises_1.default.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    }
});
(0, test_1.test)("explicit app filter returns NOT AUTOMATED when case not present in selected app", async () => {
    const indexPath = await createTempIndex([
        createEntry({ caseId: 1000, appSlug: "app-a", appProfile: "app-a" })
    ]);
    const result = await (0, case_automation_status_1.getCaseAutomationStatus)(createMockCases(1), indexPath, { appSlug: "app-b", currentProfile: "app-b" });
    (0, test_1.expect)(result.cases[0].automationStatus).toBe("not_automated");
});
(0, test_1.test)("returns active when entry appProfile matches current APP_PROFILE", async () => {
    const cases = createMockCases(1);
    const indexPath = await createTempIndex([
        createEntry({ caseId: 1000, appProfile: "saucedemo" })
    ]);
    process.env.APP_PROFILE = "saucedemo";
    try {
        const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
        (0, test_1.expect)(result.cases[0].automationStatus).toBe("active");
    }
    finally {
        delete process.env.APP_PROFILE;
    }
});
(0, test_1.test)("returns active for legacy entry without appProfile when no APP_PROFILE set", async () => {
    const cases = createMockCases(1);
    const indexPath = await createTempIndex([
        createEntry({ caseId: 1000, appProfile: undefined })
    ]);
    delete process.env.APP_PROFILE;
    const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
    (0, test_1.expect)(result.cases[0].automationStatus).toBe("active");
});
(0, test_1.test)("returns different_profile for legacy entry without appProfile when APP_PROFILE is set to non-default", async () => {
    const cases = createMockCases(1);
    const indexPath = await createTempIndex([
        createEntry({ caseId: 1000, appProfile: undefined })
    ]);
    process.env.APP_PROFILE = "kiosko";
    try {
        const result = await (0, case_automation_status_1.getCaseAutomationStatus)(cases, indexPath);
        (0, test_1.expect)(result.cases[0].automationStatus).toBe("different_profile");
    }
    finally {
        delete process.env.APP_PROFILE;
    }
});
