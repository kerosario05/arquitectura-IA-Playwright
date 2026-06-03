"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const page_objects_approve_1 = require("../src/cli/page-objects-approve");
const page_object_registry_1 = require("../src/automations/page-object-registry");
const page_object_registry_2 = require("../src/automations/page-object-registry");
const page_object_approval_1 = require("../src/automations/page-object-approval");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-page-object-approve");
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-page-object-approve");
});
test_1.test.afterAll(async () => {
    await (0, test_temp_dir_1.cleanTestTempDir)("test-page-object-approve").catch(() => { });
});
(0, test_1.test)("CLI parsea --only", () => {
    const args = (0, page_objects_approve_1.parseArgs)(["--only", "HomePage"]);
    (0, test_1.expect)(args.only).toBe("HomePage");
});
(0, test_1.test)("CLI parsea --all", () => {
    const args = (0, page_objects_approve_1.parseArgs)(["--all"]);
    (0, test_1.expect)(args.all).toBe(true);
});
(0, test_1.test)("CLI parsea --overwrite-active", () => {
    const args = (0, page_objects_approve_1.parseArgs)(["--overwrite-active"]);
    (0, test_1.expect)(args.overwriteActive).toBe(true);
});
(0, test_1.test)("CLI parsea --dry-run", () => {
    const args = (0, page_objects_approve_1.parseArgs)(["--dry-run"]);
    (0, test_1.expect)(args.dryRun).toBe(true);
});
(0, test_1.test)("CLI parsea --app", () => {
    const args = (0, page_objects_approve_1.parseArgs)(["--app", "myapp"]);
    (0, test_1.expect)(args.app).toBe("myapp");
});
(0, test_1.test)("CLI parsea flags combinados", () => {
    const args = (0, page_objects_approve_1.parseArgs)(["--app", "production", "--only", "HomePage", "--dry-run", "--overwrite-active"]);
    (0, test_1.expect)(args.app).toBe("production");
    (0, test_1.expect)(args.only).toBe("HomePage");
    (0, test_1.expect)(args.dryRun).toBe(true);
    (0, test_1.expect)(args.overwriteActive).toBe(true);
});
(0, test_1.test)("CLI rechaza unknown argument", () => {
    (0, test_1.expect)(() => (0, page_objects_approve_1.parseArgs)(["--unknown"])).toThrow("Unknown argument");
});
(0, test_1.test)("CLI --only missing value throws", () => {
    (0, test_1.expect)(() => (0, page_objects_approve_1.parseArgs)(["--only"])).toThrow("Missing value");
});
(0, test_1.test)("approve --only HomePage copia candidate a active .page.ts", async () => {
    const appSlug = "test-approve-only";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const candidateFile = node_path_1.default.join(pagesDir, "home.page.candidate.ts");
    await promises_1.default.writeFile(candidateFile, "export class HomePage {}", "utf-8");
    const result = await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: "HomePage",
        approveAll: false,
        overwriteActive: false,
        dryRun: false
    });
    (0, test_1.expect)(result.approved).toBe(1);
    (0, test_1.expect)(result.errors).toHaveLength(0);
    const activeFile = node_path_1.default.join(pagesDir, "home.page.ts");
    await (0, test_1.expect)(promises_1.default.access(activeFile)).resolves.toBeUndefined();
    const activeContent = await promises_1.default.readFile(activeFile, "utf-8");
    (0, test_1.expect)(activeContent).toBe("export class HomePage {}");
});
(0, test_1.test)("actualiza status active y available=true", async () => {
    const appSlug = "test-approve-status";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "Category",
        className: "CategoryPage",
        screenSignature: `screen:${appSlug}-category`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "selectCategory", intent: "select_category" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const candidateFile = node_path_1.default.join(pagesDir, "category.page.candidate.ts");
    await promises_1.default.writeFile(candidateFile, "export class CategoryPage {}", "utf-8");
    await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: "CategoryPage",
        approveAll: false,
        overwriteActive: false,
        dryRun: false
    });
    const updatedRegistry = await (0, page_object_registry_2.loadPageObjectRegistry)({ appSlug }, tmpDir);
    const categoryPO = updatedRegistry.pageObjects.find((po) => po.className === "CategoryPage");
    (0, test_1.expect)(categoryPO).toBeDefined();
    (0, test_1.expect)(categoryPO?.status).toBe("active");
    (0, test_1.expect)(categoryPO?.methods[0].status).toBe("active");
    (0, test_1.expect)(categoryPO?.methods[0].available).toBe(true);
    (0, test_1.expect)(categoryPO?.filePath).toContain("category.page.ts");
    const approvalMeta = categoryPO.approvalMetadata;
    (0, test_1.expect)(approvalMeta).toBeDefined();
    (0, test_1.expect)(approvalMeta.approvedBy).toBe("page-objects:approve");
    (0, test_1.expect)(approvalMeta.approvedAt).toBeDefined();
    (0, test_1.expect)(approvalMeta.approvedFrom).toContain("category.page.candidate.ts");
});
(0, test_1.test)("dry-run no escribe ni actualiza registry", async () => {
    const appSlug = "test-approve-dryrun";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const candidateFile = node_path_1.default.join(pagesDir, "home.page.candidate.ts");
    await promises_1.default.writeFile(candidateFile, "export class HomePage {}", "utf-8");
    const result = await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: "HomePage",
        approveAll: false,
        overwriteActive: false,
        dryRun: true
    });
    (0, test_1.expect)(result.approved).toBe(0);
    (0, test_1.expect)(result.skipped).toBe(1);
    const activeFile = node_path_1.default.join(pagesDir, "home.page.ts");
    await (0, test_1.expect)(promises_1.default.access(activeFile)).rejects.toThrow();
    const updatedRegistry = await (0, page_object_registry_2.loadPageObjectRegistry)({ appSlug }, tmpDir);
    const homePO = updatedRegistry.pageObjects.find((po) => po.className === "HomePage");
    (0, test_1.expect)(homePO?.status).toBe("candidate");
});
(0, test_1.test)("sin --only/--all falla", async () => {
    const appSlug = "test-approve-no-selector";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const result = await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: undefined,
        approveAll: false,
        overwriteActive: false,
        dryRun: false
    });
    (0, test_1.expect)(result.errors.length).toBeGreaterThan(0);
    (0, test_1.expect)(result.errors[0]).toContain("--only");
    (0, test_1.expect)(result.errors[0]).toContain("--all");
});
(0, test_1.test)("target existente sin --overwrite-active falla", async () => {
    const appSlug = "test-approve-existing";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const candidateFile = node_path_1.default.join(pagesDir, "home.page.candidate.ts");
    await promises_1.default.writeFile(candidateFile, "export class HomePage {}", "utf-8");
    const activeFile = node_path_1.default.join(pagesDir, "home.page.ts");
    await promises_1.default.writeFile(activeFile, "export class HomePage { existing }", "utf-8");
    const result = await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: "HomePage",
        approveAll: false,
        overwriteActive: false,
        dryRun: false
    });
    (0, test_1.expect)(result.errors.length).toBeGreaterThan(0);
    (0, test_1.expect)(result.errors[0]).toContain("--overwrite-active");
});
(0, test_1.test)("--overwrite-active permite reemplazar", async () => {
    const appSlug = "test-approve-overwrite";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const candidateFile = node_path_1.default.join(pagesDir, "home.page.candidate.ts");
    await promises_1.default.writeFile(candidateFile, "export class HomePage { approved }", "utf-8");
    const activeFile = node_path_1.default.join(pagesDir, "home.page.ts");
    await promises_1.default.writeFile(activeFile, "export class HomePage { old }", "utf-8");
    const result = await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: "HomePage",
        approveAll: false,
        overwriteActive: true,
        dryRun: false
    });
    (0, test_1.expect)(result.approved).toBe(1);
    (0, test_1.expect)(result.errors).toHaveLength(0);
    const activeContent = await promises_1.default.readFile(activeFile, "utf-8");
    (0, test_1.expect)(activeContent).toBe("export class HomePage { approved }");
});
(0, test_1.test)("source candidate missing falla con mensaje claro", async () => {
    const appSlug = "test-approve-missing";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const result = await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: "HomePage",
        approveAll: false,
        overwriteActive: false,
        dryRun: false
    });
    (0, test_1.expect)(result.errors.length).toBeGreaterThan(0);
    (0, test_1.expect)(result.errors[0]).toContain("not found");
    (0, test_1.expect)(result.errors[0]).toContain("home.page.candidate.ts");
});
(0, test_1.test)("no aprueba sensitive=true automaticamente", async () => {
    const appSlug = "test-approve-sensitive";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "LoginForm",
        className: "LoginPage",
        screenSignature: `screen:${appSlug}-login`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: []
    });
    const loginPO = registry.pageObjects.find((po) => po.className === "LoginPage");
    if (loginPO) {
        (0, page_object_registry_1.registerMethodCandidate)(registry, loginPO.id, {
            name: "fillUsername",
            intent: "fill_form_field",
            sensitive: true,
            sourceActionId: "test-1"
        });
        (0, page_object_registry_1.registerMethodCandidate)(registry, loginPO.id, {
            name: "fillPassword",
            intent: "fill_form_field",
            sensitive: true,
            sourceActionId: "test-2"
        });
    }
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const candidateFile = node_path_1.default.join(pagesDir, "login.page.candidate.ts");
    await promises_1.default.writeFile(candidateFile, "export class LoginPage {}", "utf-8");
    const result = await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: "LoginPage",
        approveAll: false,
        overwriteActive: false,
        dryRun: false
    });
    (0, test_1.expect)(result.approved).toBe(1);
    (0, test_1.expect)(result.warnings.length).toBeGreaterThan(0);
    (0, test_1.expect)(result.warnings[0]).toContain("sensitive");
    const updatedLoginRegistry = await (0, page_object_registry_2.loadPageObjectRegistry)({ appSlug }, tmpDir);
    const approvedLoginPO = updatedLoginRegistry.pageObjects.find((po) => po.className === "LoginPage");
    (0, test_1.expect)(approvedLoginPO?.methods[0].sensitive).toBe(true);
    (0, test_1.expect)(approvedLoginPO?.methods[0].available).toBe(true);
});
(0, test_1.test)("--all aprueba todos los candidates", async () => {
    const appSlug = "test-approve-all";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "Category",
        className: "CategoryPage",
        screenSignature: `screen:${appSlug}-category`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "selectCategory", intent: "select_category" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(pagesDir, "home.page.candidate.ts"), "export class HomePage {}", "utf-8");
    await promises_1.default.writeFile(node_path_1.default.join(pagesDir, "category.page.candidate.ts"), "export class CategoryPage {}", "utf-8");
    const result = await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: undefined,
        approveAll: true,
        overwriteActive: false,
        dryRun: false
    });
    (0, test_1.expect)(result.approved).toBe(2);
    (0, test_1.expect)(result.errors).toHaveLength(0);
    await (0, test_1.expect)(promises_1.default.access(node_path_1.default.join(pagesDir, "home.page.ts"))).resolves.toBeUndefined();
    await (0, test_1.expect)(promises_1.default.access(node_path_1.default.join(pagesDir, "category.page.ts"))).resolves.toBeUndefined();
});
(0, test_1.test)("candidate file no se borra tras aprobacion", async () => {
    const appSlug = "test-approve-keep-candidate";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const candidateFile = node_path_1.default.join(pagesDir, "home.page.candidate.ts");
    await promises_1.default.writeFile(candidateFile, "export class HomePage {}", "utf-8");
    await (0, page_objects_approve_1.approvePageObjectCandidates)(appSlug, tmpDir, {
        onlyClassName: "HomePage",
        approveAll: false,
        overwriteActive: false,
        dryRun: false
    });
    await (0, test_1.expect)(promises_1.default.access(candidateFile)).resolves.toBeUndefined();
});
(0, test_1.test)("auto-approve blocks LoginPage candidate when source contains OTP or literal credentials", async () => {
    const appSlug = "test-approve-login-source-block";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "LoginPage",
        className: "LoginPage",
        screenSignature: `screen:${appSlug}-login`,
        confidence: 0.9,
        sourcePlanId: "test-plan-login",
        methods: [{ name: "fillUsername", intent: "fill_username", parameters: ["value"] }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const candidateFile = node_path_1.default.join(pagesDir, "login.page.candidate.ts");
    await promises_1.default.writeFile(candidateFile, "export class LoginPage { async fillUsername(value: string) { const otp = '123456'; await this.page.fill('#user', 'admin'); } }", "utf-8");
    const result = await (0, page_object_approval_1.autoApproveSafePageObjects)(appSlug, tmpDir, {
        approveAll: true,
        overwriteActive: true,
        dryRun: false,
        confidenceThreshold: 0.5,
        blockSensitive: true
    });
    (0, test_1.expect)(result.approved).toBe(0);
    (0, test_1.expect)(result.blockedAutoApprovals.some((entry) => entry.includes("LoginPage"))).toBe(true);
    const activeFile = node_path_1.default.join(pagesDir, "login.page.ts");
    await (0, test_1.expect)(promises_1.default.access(activeFile)).rejects.toThrow();
});
