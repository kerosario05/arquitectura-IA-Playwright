"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const automation_promoter_1 = require("../src/automations/automation-promoter");
const automation_index_1 = require("../src/automations/automation-index");
const automation_reuse_1 = require("../src/automations/automation-reuse");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpRoot = (0, test_temp_dir_1.getTestTempDir)("test-automation-promoter");
function makePlan() {
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
function makeObject(key, confidence) {
    return {
        key,
        name: key,
        type: "button",
        locator: { strategy: "text", value: key, exact: false },
        tags: ["promoted", "discovery", `confidence:${confidence.toFixed(2)}`]
    };
}
test_1.test.beforeEach(async () => {
    await (0, test_temp_dir_1.cleanTestTempDir)("test-automation-promoter").catch(() => { });
    await promises_1.default.mkdir(node_path_1.default.join(tmpRoot, "automations", "plans"), { recursive: true });
    await promises_1.default.mkdir(node_path_1.default.join(tmpRoot, "tests", "generated"), { recursive: true });
    await promises_1.default.mkdir(node_path_1.default.join(tmpRoot, "discovery"), { recursive: true });
});
(0, test_1.test)("automation promovida queda disponible para reuse", async () => {
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
        const entry = await (0, automation_promoter_1.promoteDiscoveryAutomation)({
            plan: makePlan(),
            discoveryDir: node_path_1.default.join(tmpRoot, "discovery"),
            promotedObjects: [makeObject("button_primary_cta", 0.9)]
        });
        const index = await (0, automation_index_1.loadAutomationIndex)(node_path_1.default.join(tmpRoot, "automations/index.json"));
        const match = (0, automation_reuse_1.findReusableAutomation)(30001, "Generic reusable automation", index.automations);
        (0, test_1.expect)(entry.source).toBe("discovery");
        (0, test_1.expect)(match?.entry.id).toBe(entry.id);
    }
    finally {
        process.chdir(cwd);
    }
});
(0, test_1.test)("automation promovida guarda metadata de discovery", async () => {
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
        const entry = await (0, automation_promoter_1.promoteDiscoveryAutomation)({
            plan: makePlan(),
            discoveryDir: node_path_1.default.join(tmpRoot, "discovery"),
            promotedObjects: [makeObject("button_primary_cta", 0.9), makeObject("button_secondary_cta", 0.8)]
        });
        (0, test_1.expect)(entry.metadata?.discoveryDir).toContain("discovery");
        (0, test_1.expect)(entry.metadata?.promotedObjects).toEqual(["button_primary_cta", "button_secondary_cta"]);
        (0, test_1.expect)(entry.metadata?.confidenceSummary?.promotedCount).toBe(2);
    }
    finally {
        process.chdir(cwd);
    }
});
