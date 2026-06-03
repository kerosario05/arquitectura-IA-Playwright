"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const app_profile_1 = require("../src/automations/app-profile");
const page_object_registry_1 = require("../src/automations/page-object-registry");
// normalizeAppSlug tests
test_1.test.describe("normalizeAppSlug", () => {
    (0, test_1.test)('"Kiosko" -> "kiosko"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("Kiosko")).toBe("kiosko");
    });
    (0, test_1.test)('"Fenix" -> "fenix"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("Fenix")).toBe("fenix");
    });
    (0, test_1.test)('"Banca Móvil" -> "banca-movil"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("Banca Móvil")).toBe("banca-movil");
    });
    (0, test_1.test)('"App / Canales Digitales" -> "app-canales-digitales"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("App / Canales Digitales")).toBe("app-canales-digitales");
    });
    (0, test_1.test)('"  Mi App!!  " -> "mi-app"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("  Mi App!!  ")).toBe("mi-app");
    });
    (0, test_1.test)('"../evil" blocks path traversal', () => {
        const result = (0, app_profile_1.normalizeAppSlug)("../evil");
        (0, test_1.expect)(result).not.toContain("..");
        (0, test_1.expect)(result).not.toContain("/");
        (0, test_1.expect)(result).not.toContain("\\");
        (0, test_1.expect)(result).toBe("evil");
    });
    (0, test_1.test)('"" -> "default"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("")).toBe("default");
    });
    (0, test_1.test)('undefined -> "default"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)(undefined)).toBe("default");
    });
    (0, test_1.test)('"   " -> "default"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("   ")).toBe("default");
    });
    (0, test_1.test)('"default" stays "default"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("default")).toBe("default");
    });
    (0, test_1.test)('"My_App" -> "my-app"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("My_App")).toBe("my-app");
    });
    (0, test_1.test)('"App--Name" -> "app-name"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("App--Name")).toBe("app-name");
    });
    (0, test_1.test)('"-leading-trailing-" -> "leading-trailing"', () => {
        (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("-leading-trailing-")).toBe("leading-trailing");
    });
    (0, test_1.test)('"../../etc/passwd" blocks path traversal', () => {
        const result = (0, app_profile_1.normalizeAppSlug)("../../etc/passwd");
        (0, test_1.expect)(result).not.toContain("..");
        (0, test_1.expect)(result).not.toContain("/");
        (0, test_1.expect)(result).toBe("etc-passwd");
    });
    (0, test_1.test)('"..\\..\\windows\\system32" blocks path traversal', () => {
        const result = (0, app_profile_1.normalizeAppSlug)("..\\..\\windows\\system32");
        (0, test_1.expect)(result).not.toContain("..");
        (0, test_1.expect)(result).not.toContain("\\");
    });
});
// resolveAppProfile priority tests
test_1.test.describe("resolveAppProfile priority", () => {
    (0, test_1.test)("CLI --app wins over APP_SLUG", async () => {
        const result = await (0, app_profile_1.resolveAppProfile)({
            cliAppSlug: "kiosko",
            envAppSlug: "fenix"
        });
        (0, test_1.expect)(result.profile.appSlug).toBe("kiosko");
        (0, test_1.expect)(result.profile.source).toBe("cli");
    });
    (0, test_1.test)("APP_SLUG wins over TestRail project", async () => {
        const result = await (0, app_profile_1.resolveAppProfile)({
            envAppSlug: "fenix",
            testRailProjectId: "123",
            testRailBaseUrl: "https://testrail.example.com",
            testRailEmail: "test@example.com",
            testRailApiKey: "fake-key"
        });
        (0, test_1.expect)(result.profile.appSlug).toBe("fenix");
        (0, test_1.expect)(result.profile.source).toBe("env");
    });
    (0, test_1.test)("TestRail project wins over default", async () => {
        const result = await (0, app_profile_1.resolveAppProfile)({
            testRailProjectId: "123",
            testRailBaseUrl: "https://testrail.example.com",
            testRailEmail: "test@example.com",
            testRailApiKey: "fake-key"
        });
        // TestRail will fail to connect, so it falls back to default
        (0, test_1.expect)(result.profile.source).toBe("default");
        (0, test_1.expect)(result.profile.appSlug).toBe("default");
    });
    (0, test_1.test)("default when nothing specified", async () => {
        const result = await (0, app_profile_1.resolveAppProfile)({});
        (0, test_1.expect)(result.profile.appSlug).toBe("default");
        (0, test_1.expect)(result.profile.source).toBe("default");
    });
    (0, test_1.test)("default when TestRail fails", async () => {
        const result = await (0, app_profile_1.resolveAppProfile)({
            testRailProjectId: "999999",
            testRailBaseUrl: "https://invalid.example.com",
            testRailEmail: "test@example.com",
            testRailApiKey: "invalid-key"
        });
        (0, test_1.expect)(result.profile.appSlug).toBe("default");
        (0, test_1.expect)(result.profile.source).toBe("default");
    });
    (0, test_1.test)("baseDir is correct for custom appSlug", async () => {
        const result = await (0, app_profile_1.resolveAppProfile)({ cliAppSlug: "my-app" });
        (0, test_1.expect)(result.baseDir).toBe(node_path_1.default.join("automations", "apps", "my-app"));
    });
    (0, test_1.test)("baseDir is correct for default", async () => {
        const result = await (0, app_profile_1.resolveAppProfile)({});
        (0, test_1.expect)(result.baseDir).toBe(node_path_1.default.join("automations", "apps", "default"));
    });
});
// ensureAppStructure tests
test_1.test.describe("ensureAppStructure", () => {
    const testDir = node_path_1.default.join(".tmp-test-app-structure", "test-app");
    test_1.test.afterEach(async () => {
        await promises_1.default.rm(node_path_1.default.dirname(testDir), { recursive: true, force: true });
    });
    (0, test_1.test)("creates structure if not exists", async () => {
        const created = await (0, app_profile_1.ensureAppStructure)(testDir);
        (0, test_1.expect)(created.sort()).toContain("cases");
        (0, test_1.expect)(created.sort()).toContain("flows");
        (0, test_1.expect)(created.sort()).toContain("lib");
        (0, test_1.expect)(created.sort()).toContain("pages");
        for (const subdir of ["pages", "flows", "cases", "lib"]) {
            const stat = await promises_1.default.stat(node_path_1.default.join(testDir, subdir));
            (0, test_1.expect)(stat.isDirectory()).toBe(true);
        }
    });
    (0, test_1.test)("reuses structure if already exists", async () => {
        await (0, app_profile_1.ensureAppStructure)(testDir);
        const created = await (0, app_profile_1.ensureAppStructure)(testDir);
        (0, test_1.expect)(created).toEqual([]);
    });
    (0, test_1.test)("creates only missing subdirectories", async () => {
        await (0, app_profile_1.ensureAppStructure)(testDir);
        await promises_1.default.rm(node_path_1.default.join(testDir, "lib"), { recursive: true });
        const created = await (0, app_profile_1.ensureAppStructure)(testDir);
        (0, test_1.expect)(created).toEqual(["lib"]);
    });
    (0, test_1.test)("does not delete existing files", async () => {
        await (0, app_profile_1.ensureAppStructure)(testDir);
        const existingFile = node_path_1.default.join(testDir, "pages", "existing.page.ts");
        await promises_1.default.writeFile(existingFile, "// existing", "utf-8");
        await (0, app_profile_1.ensureAppStructure)(testDir);
        const content = await promises_1.default.readFile(existingFile, "utf-8");
        (0, test_1.expect)(content).toBe("// existing");
    });
    (0, test_1.test)("registers framework page objects through the shared registry helpers", async () => {
        const registryRoot = node_path_1.default.join("registry-test-app-structure", "automations", "apps", "test-app");
        try {
            await (0, app_profile_1.ensureAppStructure)(registryRoot);
            const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "test-app" }, node_path_1.default.join("registry-test-app-structure"));
            (0, test_1.expect)(registry.pageObjects.some((po) => po.className === "ProductListPage")).toBe(true);
            (0, test_1.expect)(registry.pageObjects.some((po) => po.className === "OperationsMenuPage")).toBe(true);
        }
        finally {
            await promises_1.default.rm(node_path_1.default.join("registry-test-app-structure"), { recursive: true, force: true });
        }
    });
});
// Isolation tests
test_1.test.describe("app isolation", () => {
    (0, test_1.test)("kiosko does not write to default", async () => {
        const kioskoResult = await (0, app_profile_1.resolveAppProfile)({ cliAppSlug: "kiosko" });
        const defaultResult = await (0, app_profile_1.resolveAppProfile)({});
        (0, test_1.expect)(kioskoResult.baseDir).not.toBe(defaultResult.baseDir);
        (0, test_1.expect)(kioskoResult.baseDir).toContain("kiosko");
        (0, test_1.expect)(defaultResult.baseDir).toContain("default");
    });
    (0, test_1.test)("app-a does not modify app-b", async () => {
        const appAResult = await (0, app_profile_1.resolveAppProfile)({ cliAppSlug: "app-a" });
        const appBResult = await (0, app_profile_1.resolveAppProfile)({ cliAppSlug: "app-b" });
        (0, test_1.expect)(appAResult.baseDir).not.toBe(appBResult.baseDir);
        (0, test_1.expect)(appAResult.baseDir).toContain("app-a");
        (0, test_1.expect)(appBResult.baseDir).toContain("app-b");
    });
    (0, test_1.test)("fenix does not import from kiosko", async () => {
        const fenixResult = await (0, app_profile_1.resolveAppProfile)({ cliAppSlug: "fenix" });
        const kioskoResult = await (0, app_profile_1.resolveAppProfile)({ cliAppSlug: "kiosko" });
        (0, test_1.expect)(fenixResult.baseDir).not.toContain("kiosko");
        (0, test_1.expect)(kioskoResult.baseDir).not.toContain("fenix");
    });
});
// logAppProfile tests
test_1.test.describe("logAppProfile", () => {
    (0, test_1.test)("logs CLI source correctly", () => {
        const profile = {
            appSlug: "kiosko",
            source: "cli",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
        };
        const lines = [];
        const origLog = console.log;
        console.log = (msg) => lines.push(msg);
        (0, app_profile_1.logAppProfile)(profile, "automations/apps/kiosko", ["pages", "flows"]);
        console.log = origLog;
        (0, test_1.expect)(lines.some(l => l.includes("appSlug=kiosko"))).toBe(true);
        (0, test_1.expect)(lines.some(l => l.includes("source=cli"))).toBe(true);
        (0, test_1.expect)(lines.some(l => l.includes("baseDir=automations/apps/kiosko"))).toBe(true);
    });
    (0, test_1.test)("logs env source correctly", () => {
        const profile = {
            appSlug: "fenix",
            source: "env",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
        };
        const lines = [];
        const origLog = console.log;
        console.log = (msg) => lines.push(msg);
        (0, app_profile_1.logAppProfile)(profile, "automations/apps/fenix");
        console.log = origLog;
        (0, test_1.expect)(lines.some(l => l.includes("appSlug=fenix"))).toBe(true);
        (0, test_1.expect)(lines.some(l => l.includes("source=env"))).toBe(true);
    });
    (0, test_1.test)("logs default source correctly", () => {
        const profile = {
            appSlug: "default",
            source: "default",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
        };
        const lines = [];
        const origLog = console.log;
        console.log = (msg) => lines.push(msg);
        (0, app_profile_1.logAppProfile)(profile, "automations/apps/default");
        console.log = origLog;
        (0, test_1.expect)(lines.some(l => l.includes("appSlug=default"))).toBe(true);
        (0, test_1.expect)(lines.some(l => l.includes("source=default"))).toBe(true);
    });
});
// AuthFlow dependency bundle tests
test_1.test.describe("AuthFlow dependency bundle", () => {
    const testDir = node_path_1.default.join(".tmp-test-app-structure", "authflow-test-app");
    test_1.test.afterEach(async () => {
        await promises_1.default.rm(node_path_1.default.dirname(testDir), { recursive: true, force: true });
    });
    (0, test_1.test)("ensureAppStructure copies AuthFlow dependency files from default app", async () => {
        const created = await (0, app_profile_1.ensureAppStructure)(testDir);
        (0, test_1.expect)(created.some(f => f.startsWith("flows/"))).toBe(true);
        (0, test_1.expect)(created.some(f => f.startsWith("pages/"))).toBe(true);
        (0, test_1.expect)(created.some(f => f.startsWith("components/"))).toBe(true);
        (0, test_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(testDir, "flows", "auth.flow.ts"))).toBe(true);
        (0, test_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(testDir, "flows", "auth.flow.js"))).toBe(true);
        (0, test_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(testDir, "flows", "auth.flow.helpers.ts"))).toBe(true);
        (0, test_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(testDir, "pages", "identification.page.ts"))).toBe(true);
        (0, test_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(testDir, "pages", "phoneconfirmation.page.ts"))).toBe(true);
        (0, test_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(testDir, "pages", "operationsmenu.page.ts"))).toBe(true);
        (0, test_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(testDir, "components", "otp.component.ts"))).toBe(true);
        (0, test_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(testDir, "components", "virtual-keyboard.component.ts"))).toBe(true);
    });
    (0, test_1.test)("ensureAppStructure creates components directory", async () => {
        await (0, app_profile_1.ensureAppStructure)(testDir);
        const stat = await promises_1.default.stat(node_path_1.default.join(testDir, "components"));
        (0, test_1.expect)(stat.isDirectory()).toBe(true);
    });
    (0, test_1.test)("ensureAppStructure does not overwrite existing app-specific files", async () => {
        await (0, app_profile_1.ensureAppStructure)(testDir);
        const customPage = node_path_1.default.join(testDir, "pages", "custom.page.ts");
        await promises_1.default.writeFile(customPage, "// custom page", "utf-8");
        const created = await (0, app_profile_1.ensureAppStructure)(testDir);
        (0, test_1.expect)(created).toEqual([]);
        const content = await promises_1.default.readFile(customPage, "utf-8");
        (0, test_1.expect)(content).toBe("// custom page");
    });
    (0, test_1.test)("validateAuthFlowDependencies returns valid when all files exist", () => {
        const result = (0, app_profile_1.validateAuthFlowDependencies)(node_path_1.default.resolve("automations/apps/default"));
        (0, test_1.expect)(result.valid).toBe(true);
        (0, test_1.expect)(result.missing).toHaveLength(0);
    });
    (0, test_1.test)("validateAuthFlowDependencies returns missing files when they don't exist", async () => {
        await promises_1.default.mkdir(node_path_1.default.join(testDir, "flows"), { recursive: true });
        await promises_1.default.mkdir(node_path_1.default.join(testDir, "pages"), { recursive: true });
        await promises_1.default.mkdir(node_path_1.default.join(testDir, "components"), { recursive: true });
        const result = (0, app_profile_1.validateAuthFlowDependencies)(testDir);
        (0, test_1.expect)(result.valid).toBe(false);
        (0, test_1.expect)(result.missing.length).toBeGreaterThan(0);
        (0, test_1.expect)(result.missing.some(f => f.includes("auth.flow"))).toBe(true);
    });
});
test_1.test.describe("promoted app config IO", () => {
    const outputRoot = node_path_1.default.join("registry-test-app-config");
    test_1.test.afterEach(async () => {
        await promises_1.default.rm(outputRoot, { recursive: true, force: true });
    });
    (0, test_1.test)("savePromotedAppConfig writes atomically and loadPromotedAppConfigSync reads it back", async () => {
        await (0, app_profile_1.savePromotedAppConfig)({
            appProfile: {
                appSlug: "io-app",
                source: "default",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            baseUrl: "https://example.test",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            testDataRefs: {},
            missingInputBehavior: "fail",
            updatedAt: new Date().toISOString()
        }, outputRoot);
        const loaded = (0, app_profile_1.loadPromotedAppConfigSync)({
            appSlug: "io-app",
            configPath: node_path_1.default.join(outputRoot, "automations", "apps", "io-app", "app.config.json")
        });
        (0, test_1.expect)(loaded?.baseUrl).toBe("https://example.test");
        (0, test_1.expect)(loaded?.appProfile.appSlug).toBe("io-app");
    });
});
test_1.test.describe("route profile multi-app isolation", () => {
    const appARoot = node_path_1.default.resolve("automations/apps/test-preview-app-a");
    const appBRoot = node_path_1.default.resolve("automations/apps/test-preview-app-b");
    test_1.test.afterEach(async () => {
        await promises_1.default.rm(appARoot, { recursive: true, force: true });
        await promises_1.default.rm(appBRoot, { recursive: true, force: true });
    });
    (0, test_1.test)("loadRouteProfile usa automations/apps/<appSlug>/app.config.json correcto", async () => {
        await promises_1.default.mkdir(appARoot, { recursive: true });
        await promises_1.default.mkdir(appBRoot, { recursive: true });
        await promises_1.default.writeFile(node_path_1.default.join(appARoot, "app.config.json"), JSON.stringify({
            appProfile: { appSlug: "test-preview-app-a", source: "default", createdAt: "", updatedAt: "" },
            baseUrl: "https://app-a.example.test",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            testDataRefs: {},
            missingInputBehavior: "fail",
            updatedAt: new Date().toISOString(),
            routeProfile: {
                name: "app-a-profile",
                domainTerms: ["tarjeta", "cuenta"],
            }
        }, null, 2), "utf-8");
        await promises_1.default.writeFile(node_path_1.default.join(appBRoot, "app.config.json"), JSON.stringify({
            appProfile: { appSlug: "test-preview-app-b", source: "default", createdAt: "", updatedAt: "" },
            baseUrl: "https://app-b.example.test",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            testDataRefs: {},
            missingInputBehavior: "fail",
            updatedAt: new Date().toISOString(),
            routeProfile: {
                name: "app-b-profile",
                domainTerms: ["prestamo"],
            }
        }, null, 2), "utf-8");
        const routeProfileA = (0, app_profile_1.loadRouteProfile)("test-preview-app-a");
        const routeProfileB = (0, app_profile_1.loadRouteProfile)("test-preview-app-b");
        (0, test_1.expect)(routeProfileA?.domainTerms).toEqual(["tarjeta", "cuenta"]);
        (0, test_1.expect)(routeProfileB?.domainTerms).toEqual(["prestamo"]);
    });
});
