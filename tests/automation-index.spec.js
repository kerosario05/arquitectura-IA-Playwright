"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const automation_index_1 = require("../src/automations/automation-index");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-automation-index");
function makeEntry(id, overrides) {
    return {
        id,
        externalId: id,
        caseId: Number(id.replace(/\D/g, "")) || undefined,
        title: `Automation ${id}`,
        planPath: `automations/plans/${id}.plan.json`,
        specPath: `tests/generated/${id}.spec.ts`,
        status: "active",
        source: "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides
    };
}
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-automation-index");
});
test_1.test.afterAll(async () => {
    try {
        await (0, test_temp_dir_1.cleanTestTempDir)("test-automation-index");
    }
    catch {
    }
});
(0, test_1.test)("loadAutomationIndex creates empty index when file does not exist", async () => {
    const indexPath = node_path_1.default.join(tmpDir, "nonexistent.json");
    const index = await (0, automation_index_1.loadAutomationIndex)(indexPath);
    (0, test_1.expect)(index.version).toBe("1.0");
    (0, test_1.expect)(index.automations).toEqual([]);
});
(0, test_1.test)("loadAutomationIndex loads existing index", async () => {
    const indexPath = node_path_1.default.join(tmpDir, "existing.json");
    const existing = {
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: [makeEntry("C1")]
    };
    await (0, automation_index_1.saveAutomationIndex)(existing, indexPath);
    const loaded = await (0, automation_index_1.loadAutomationIndex)(indexPath);
    (0, test_1.expect)(loaded.automations).toHaveLength(1);
    (0, test_1.expect)(loaded.automations[0].id).toBe("C1");
});
(0, test_1.test)("loadAutomationIndex throws on invalid version", async () => {
    const indexPath = node_path_1.default.join(tmpDir, "bad-version.json");
    await promises_1.default.writeFile(indexPath, JSON.stringify({ version: "99.0", automations: [] }), "utf-8");
    await (0, test_1.expect)((0, automation_index_1.loadAutomationIndex)(indexPath)).rejects.toThrow();
});
(0, test_1.test)("upsertAutomationIndexEntry adds entry to empty list", () => {
    const index = {
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: []
    };
    const result = (0, automation_index_1.upsertAutomationIndexEntry)(index, makeEntry("C1"));
    (0, test_1.expect)(result.automations).toHaveLength(1);
    (0, test_1.expect)(result.automations[0].id).toBe("C1");
});
(0, test_1.test)("upsertAutomationIndexEntry updates existing entry by id", () => {
    const index = {
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: [makeEntry("C1")]
    };
    const updated = makeEntry("C1");
    updated.status = "disabled";
    const result = (0, automation_index_1.upsertAutomationIndexEntry)(index, updated);
    (0, test_1.expect)(result.automations).toHaveLength(1);
    (0, test_1.expect)(result.automations[0].status).toBe("disabled");
    (0, test_1.expect)(result.automations[0].createdAt).toBe(index.automations[0].createdAt);
});
(0, test_1.test)("upsertAutomationIndexEntry preserves existing entries when adding new", () => {
    const index = {
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: [makeEntry("C1")]
    };
    const result = (0, automation_index_1.upsertAutomationIndexEntry)(index, makeEntry("C2"));
    (0, test_1.expect)(result.automations).toHaveLength(2);
});
(0, test_1.test)("upsertAutomationIndexEntry maintains version 1.0", () => {
    const index = {
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: []
    };
    const result = (0, automation_index_1.upsertAutomationIndexEntry)(index, makeEntry("C1"));
    (0, test_1.expect)(result.version).toBe("1.0");
});
(0, test_1.test)("saveAutomationIndex and loadAutomationIndex round-trip correctly", async () => {
    const indexPath = node_path_1.default.join(tmpDir, "roundtrip.json");
    const original = {
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: [makeEntry("C1"), makeEntry("C2")]
    };
    await (0, automation_index_1.saveAutomationIndex)(original, indexPath);
    const loaded = await (0, automation_index_1.loadAutomationIndex)(indexPath);
    (0, test_1.expect)(loaded.automations).toHaveLength(2);
    (0, test_1.expect)(loaded.version).toBe("1.0");
});
(0, test_1.test)("index entries preserve appSlug and appConfigPath", async () => {
    const indexPath = node_path_1.default.join(tmpDir, "app-aware.json");
    const entry = makeEntry("C-app", {
        appSlug: "profile-a",
        appConfigPath: "automations/apps/profile-a/app.config.json"
    });
    await (0, automation_index_1.saveAutomationIndex)({
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: [entry]
    }, indexPath);
    const loaded = await (0, automation_index_1.loadAutomationIndex)(indexPath);
    (0, test_1.expect)(loaded.automations[0].appSlug).toBe("profile-a");
    (0, test_1.expect)(loaded.automations[0].appConfigPath).toContain("app.config.json");
});
(0, test_1.test)("loadAutomationIndex retries transient read errors", async () => {
    const indexPath = node_path_1.default.join(tmpDir, "retry.json");
    await (0, automation_index_1.saveAutomationIndex)({
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: [makeEntry("C1")]
    }, indexPath);
    const originalReadFile = promises_1.default.readFile;
    let attempts = 0;
    promises_1.default.readFile = async (...args) => {
        attempts += 1;
        if (attempts < 3) {
            const error = new Error("busy");
            error.code = "EBUSY";
            throw error;
        }
        return originalReadFile(...args);
    };
    try {
        const loaded = await (0, automation_index_1.loadAutomationIndex)(indexPath);
        (0, test_1.expect)(loaded.automations).toHaveLength(1);
        (0, test_1.expect)(attempts).toBe(3);
    }
    finally {
        promises_1.default.readFile = originalReadFile;
    }
});
