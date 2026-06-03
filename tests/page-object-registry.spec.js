"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const page_object_registry_1 = require("../src/automations/page-object-registry");
function emptyReg() {
    return { version: "1.0", appSlug: "test", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
}
(0, test_1.test)("createEmptyRegistry produces empty registry", () => {
    const reg = emptyReg();
    (0, test_1.expect)(reg.version).toBe("1.0");
    (0, test_1.expect)(reg.appSlug).toBe("test");
    (0, test_1.expect)(reg.pageObjects).toHaveLength(0);
    (0, test_1.expect)(reg.componentCandidates).toHaveLength(0);
});
(0, test_1.test)("registerPageObjectCandidate adds new entry", () => {
    const reg = emptyReg();
    const { registry, created } = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "LoginPage",
        className: "LoginPage",
        screenSignature: "signature:login",
        confidence: 0.9,
        sourcePlanId: "plan_1"
    });
    (0, test_1.expect)(created).toBe(true);
    (0, test_1.expect)(registry.pageObjects).toHaveLength(1);
    (0, test_1.expect)(registry.pageObjects[0].className).toBe("LoginPage");
    (0, test_1.expect)(registry.pageObjects[0].screenSignature).toBe("signature:login");
});
(0, test_1.test)("registerPageObjectCandidate does not duplicate same signature", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "LoginPage", className: "LoginPage", screenSignature: "sig1", confidence: 0.9, sourcePlanId: "plan_1"
    });
    (0, test_1.expect)(r1.created).toBe(true);
    const r2 = (0, page_object_registry_1.registerPageObjectCandidate)(r1.registry, {
        name: "LoginPage", className: "LoginPage", screenSignature: "sig1", confidence: 0.9, sourcePlanId: "plan_2"
    });
    (0, test_1.expect)(r2.created).toBe(false);
    (0, test_1.expect)(r2.registry.pageObjects).toHaveLength(1);
});
(0, test_1.test)("registerPageObjectCandidate adds sourcePlanId to existing", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "LoginPage", className: "LoginPage", screenSignature: "sig1", confidence: 0.9, sourcePlanId: "plan_1"
    });
    const r2 = (0, page_object_registry_1.registerPageObjectCandidate)(r1.registry, {
        name: "LoginPage", className: "LoginPage", screenSignature: "sig1", confidence: 0.9, sourcePlanId: "plan_2"
    });
    (0, test_1.expect)(r2.registry.pageObjects[0].sourcePlanIds).toContain("plan_1");
    (0, test_1.expect)(r2.registry.pageObjects[0].sourcePlanIds).toContain("plan_2");
});
(0, test_1.test)("findPageObjectByScreenSignature finds active PO", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1"
    });
    (0, page_object_registry_1.markPageObjectActive)(r1.registry, r1.registry.pageObjects[0].id);
    const found = (0, page_object_registry_1.findPageObjectByScreenSignature)(r1.registry, "sig:menu");
    (0, test_1.expect)(found).toBeDefined();
    (0, test_1.expect)(found.className).toBe("MenuPage");
});
(0, test_1.test)("findPageObjectByScreenSignature ignores candidates", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1"
    });
    const found = (0, page_object_registry_1.findPageObjectByScreenSignature)(r1.registry, "sig:menu");
    (0, test_1.expect)(found).toBeUndefined();
});
(0, test_1.test)("registerMethodCandidate adds method to PO", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "selectOption", intent: "click" }]
    });
    const poId = r1.registry.pageObjects[0].id;
    const r2 = (0, page_object_registry_1.registerMethodCandidate)(r1.registry, poId, {
        name: "openMenu", intent: "navigate", sourceActionId: "action_1"
    });
    (0, test_1.expect)(r2.created).toBe(true);
    (0, test_1.expect)(r2.registry.pageObjects[0].methods).toHaveLength(2);
});
(0, test_1.test)("registerMethodCandidate does not duplicate intent", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "selectOption", intent: "click" }]
    });
    const poId = r1.registry.pageObjects[0].id;
    const r2 = (0, page_object_registry_1.registerMethodCandidate)(r1.registry, poId, {
        name: "clickOption", intent: "click", sourceActionId: "action_2"
    });
    (0, test_1.expect)(r2.created).toBe(false);
});
(0, test_1.test)("findMethodForIntent returns available method", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "selectOption", intent: "click" }]
    });
    const po = r1.registry.pageObjects[0];
    (0, page_object_registry_1.markMethodActive)(r1.registry, po.id, "selectOption");
    const found = (0, page_object_registry_1.findMethodForIntent)(po, "click");
    (0, test_1.expect)(found).toBeDefined();
    (0, test_1.expect)(found.name).toBe("selectOption");
});
(0, test_1.test)("findMethodForIntent returns undefined for candidate method", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "selectOption", intent: "click" }]
    });
    const po = r1.registry.pageObjects[0];
    const found = (0, page_object_registry_1.findMethodForIntent)(po, "click");
    (0, test_1.expect)(found).toBeUndefined();
});
(0, test_1.test)("markMethodActive sets status to active and available true", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "selectOption", intent: "click" }]
    });
    const po = r1.registry.pageObjects[0];
    const ok = (0, page_object_registry_1.markMethodActive)(r1.registry, po.id, "selectOption");
    (0, test_1.expect)(ok).toBe(true);
    (0, test_1.expect)(po.methods[0].available).toBe(true);
    (0, test_1.expect)(po.methods[0].status).toBe("active");
});
(0, test_1.test)("markPageObjectActive does nothing if already active", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1"
    });
    const poId = r1.registry.pageObjects[0].id;
    (0, page_object_registry_1.markPageObjectActive)(r1.registry, poId);
    const again = (0, page_object_registry_1.markPageObjectActive)(r1.registry, poId);
    (0, test_1.expect)(again).toBe(false);
});
(0, test_1.test)("findReusableMethod finds method by intent across active POs", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "LoginPage", className: "LoginPage", screenSignature: "sig:login", confidence: 0.9, sourcePlanId: "plan_1",
        methods: [{ name: "login", intent: "login" }]
    });
    const poId = r1.registry.pageObjects[0].id;
    (0, page_object_registry_1.markPageObjectActive)(r1.registry, poId);
    (0, page_object_registry_1.markMethodActive)(r1.registry, poId, "login");
    const found = (0, page_object_registry_1.findReusableMethod)(r1.registry, "login");
    (0, test_1.expect)(found).toBeDefined();
    (0, test_1.expect)(found.method.name).toBe("login");
});
(0, test_1.test)("findReusableMethod with screenSignature filters correctly", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "LoginPage", className: "LoginPage", screenSignature: "sig:login", confidence: 0.9, sourcePlanId: "plan_1",
        methods: [{ name: "login", intent: "login" }]
    });
    const r2 = (0, page_object_registry_1.registerPageObjectCandidate)(r1.registry, {
        name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.9, sourcePlanId: "plan_2",
        methods: [{ name: "login", intent: "login" }]
    });
    (0, page_object_registry_1.markPageObjectActive)(r2.registry, r2.registry.pageObjects[0].id);
    (0, page_object_registry_1.markMethodActive)(r2.registry, r2.registry.pageObjects[0].id, "login");
    (0, page_object_registry_1.markPageObjectActive)(r2.registry, r2.registry.pageObjects[1].id);
    (0, page_object_registry_1.markMethodActive)(r2.registry, r2.registry.pageObjects[1].id, "login");
    const found = (0, page_object_registry_1.findReusableMethod)(r2.registry, "login", "sig:home");
    (0, test_1.expect)(found).toBeDefined();
    (0, test_1.expect)(found.pageObject.className).toBe("HomePage");
});
(0, test_1.test)("registerComponentCandidate adds new component", () => {
    const reg = emptyReg();
    const { registry, created } = (0, page_object_registry_1.registerComponentCandidate)(reg, {
        name: "DatePicker", className: "DatePickerComponent", componentSignature: "sig:datepicker", confidence: 0.75
    });
    (0, test_1.expect)(created).toBe(true);
    (0, test_1.expect)(registry.componentCandidates).toHaveLength(1);
});
(0, test_1.test)("registerComponentCandidate does not duplicate", () => {
    const reg = emptyReg();
    const r1 = (0, page_object_registry_1.registerComponentCandidate)(reg, {
        name: "DatePicker", className: "DatePickerComponent", componentSignature: "sig:datepicker", confidence: 0.75
    });
    const r2 = (0, page_object_registry_1.registerComponentCandidate)(r1.registry, {
        name: "DatePicker", className: "DatePickerComponent", componentSignature: "sig:datepicker", confidence: 0.8
    });
    (0, test_1.expect)(r2.created).toBe(false);
});
(0, test_1.test)("loadPageObjectRegistry initializes empty registry when file is missing", async () => {
    const tmpDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "po-reg-missing-"));
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "isolated-app" }, tmpDir);
    (0, test_1.expect)(registry.appSlug).toBe("isolated-app");
    (0, test_1.expect)(registry.pageObjects).toHaveLength(0);
});
(0, test_1.test)("savePageObjectRegistry writes valid JSON atomically", async () => {
    const tmpDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "po-reg-atomic-"));
    const registry = emptyReg();
    registry.appSlug = "atomic-app";
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: "sig:home",
        confidence: 0.9,
        sourcePlanId: "plan_1"
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug: "atomic-app" }, tmpDir);
    const registryPath = node_path_1.default.join(tmpDir, "automations", "apps", "atomic-app", "page-objects.index.json");
    const raw = await promises_1.default.readFile(registryPath, "utf-8");
    (0, test_1.expect)(() => JSON.parse(raw)).not.toThrow();
});
(0, test_1.test)("loadPageObjectRegistry retries transient read errors", async () => {
    const tmpDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "po-reg-retry-"));
    const registry = emptyReg();
    registry.appSlug = "retry-app";
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug: "retry-app" }, tmpDir);
    const originalReadFile = promises_1.default.readFile;
    let attempts = 0;
    promises_1.default.readFile = async (...args) => {
        attempts += 1;
        if (attempts === 1) {
            const error = new Error("busy");
            error.code = "EBUSY";
            throw error;
        }
        return originalReadFile.apply(promises_1.default, args);
    };
    try {
        const loaded = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "retry-app" }, tmpDir);
        (0, test_1.expect)(loaded.appSlug).toBe("retry-app");
        (0, test_1.expect)(attempts).toBeGreaterThan(1);
    }
    finally {
        promises_1.default.readFile = originalReadFile;
    }
});
(0, test_1.test)("loadPageObjectRegistry reports invalid JSON clearly", async () => {
    const tmpDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "po-reg-invalid-"));
    const registryPath = node_path_1.default.join(tmpDir, "automations", "apps", "broken-app", "page-objects.index.json");
    await promises_1.default.mkdir(node_path_1.default.dirname(registryPath), { recursive: true });
    await promises_1.default.writeFile(registryPath, "{ invalid json", "utf-8");
    await (0, test_1.expect)((0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "broken-app" }, tmpDir)).rejects.toThrow(/Invalid JSON in page object registry/);
});
(0, test_1.test)("loadPageObjectRegistry keeps app isolation by appSlug", async () => {
    const tmpDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "po-reg-apps-"));
    const left = emptyReg();
    left.appSlug = "app-left";
    const right = emptyReg();
    right.appSlug = "app-right";
    (0, page_object_registry_1.registerPageObjectCandidate)(left, {
        name: "LeftPage",
        className: "LeftPage",
        screenSignature: "sig:left",
        confidence: 0.8,
        sourcePlanId: "plan_left"
    });
    (0, page_object_registry_1.registerPageObjectCandidate)(right, {
        name: "RightPage",
        className: "RightPage",
        screenSignature: "sig:right",
        confidence: 0.8,
        sourcePlanId: "plan_right"
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(left, { appSlug: "app-left" }, tmpDir);
    await (0, page_object_registry_1.savePageObjectRegistry)(right, { appSlug: "app-right" }, tmpDir);
    const loadedLeft = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "app-left" }, tmpDir);
    const loadedRight = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "app-right" }, tmpDir);
    (0, test_1.expect)(loadedLeft.pageObjects[0].className).toBe("LeftPage");
    (0, test_1.expect)(loadedRight.pageObjects[0].className).toBe("RightPage");
});
