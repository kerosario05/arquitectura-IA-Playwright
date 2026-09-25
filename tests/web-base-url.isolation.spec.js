"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const discovery_preview_1 = require("../src/cli/discovery-preview");
const project_reader_1 = require("../src/db/project-reader");
const TEST_APP_SLUG = "project-a-test-isolation";
const TEST_APP_DIR = node_path_1.default.join(process.cwd(), "automations", "apps", TEST_APP_SLUG);
const TEST_CONFIG_PATH = node_path_1.default.join(TEST_APP_DIR, "app.config.json");
function ensureTestApp(baseUrl) {
    node_fs_1.default.mkdirSync(TEST_APP_DIR, { recursive: true });
    const cfg = {
        name: "Project A Test",
        baseUrl,
        loginMode: "no_login",
        testData: {},
        testDataAliases: {},
        missingInputBehavior: "auto_generate",
    };
    node_fs_1.default.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}
function cleanupTestApp() {
    try {
        node_fs_1.default.rmSync(TEST_APP_DIR, { recursive: true, force: true });
    }
    catch { }
}
test_1.test.describe("web:base-url isolation", () => {
    test_1.test.afterEach(() => cleanupTestApp());
    (0, test_1.test)("proyecto genérico A: effective=project-a.example, nunca default.example", () => {
        const projectBaseUrl = "https://project-a.example/";
        // Env/default would be https://default.example/ but must not be used
        ensureTestApp(projectBaseUrl);
        // Ensure env default is different (simulate global env = default.example)
        // resolveWebBaseUrl must return project config, not env
        const result = (0, discovery_preview_1.resolveWebBaseUrl)(TEST_APP_SLUG);
        (0, test_1.expect)(result.appSlug).toBe(TEST_APP_SLUG);
        (0, test_1.expect)(result.source).toBe("app_config");
        (0, test_1.expect)(result.configured).toBe(projectBaseUrl);
        (0, test_1.expect)(result.effective).toBe(projectBaseUrl);
        (0, test_1.expect)(result.fallbackUsed).toBe(false);
        (0, test_1.expect)(result.effective).not.toBe("https://default.example/");
        (0, test_1.expect)(result.effective).not.toContain("default.example");
    });
    (0, test_1.test)("runtime preview prefers the active project configuration over a stale app config", async () => {
        const project = await (0, project_reader_1.getProjectConfigurationBySlug)("portalempresarial");
        test_1.test.skip(!project?.web?.baseUrl, "active project has no SQL web configuration");
        const result = await (0, discovery_preview_1.resolveRuntimeWebBaseUrl)("portalempresarial");
        (0, test_1.expect)(result.source).toBe("project_sql");
        (0, test_1.expect)(result.fallbackUsed).toBe(false);
        (0, test_1.expect)(result.effective).toBe(project.web.baseUrl);
    });
    (0, test_1.test)("FAIL CLOSED: appSlug con config sin baseUrl debe fallar, no fallback silencioso", () => {
        // Create config without baseUrl (empty)
        node_fs_1.default.mkdirSync(TEST_APP_DIR, { recursive: true });
        const cfg = {
            name: "Project A Missing",
            loginMode: "no_login",
            // baseUrl missing
        };
        node_fs_1.default.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
        (0, test_1.expect)(() => (0, discovery_preview_1.resolveWebBaseUrl)(TEST_APP_SLUG)).toThrow(/FAIL CLOSED|missing baseUrl/);
    });
    (0, test_1.test)("FAIL CLOSED: appSlug inexistente debe fallar, no usar default", () => {
        const missingSlug = "nonexistent-project-xyz-12345";
        // Ensure no dir exists
        const missingDir = node_path_1.default.join(process.cwd(), "automations", "apps", missingSlug);
        try {
            node_fs_1.default.rmSync(missingDir, { recursive: true, force: true });
        }
        catch { }
        (0, test_1.expect)(() => (0, discovery_preview_1.resolveWebBaseUrl)(missingSlug)).toThrow(/FAIL CLOSED|missing baseUrl/);
    });
});
