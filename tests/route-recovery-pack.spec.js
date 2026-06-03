"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const route_recovery_pack_1 = require("../src/agent/route-recovery-pack");
const samplePlan = {
    version: "1.0",
    source: "ai_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 123, title: "Sample case" },
    requiredData: [],
    steps: [
        { index: 0, action: "navigate", target: "APP_BASE_URL" },
        { index: 1, action: "click", target: { strategy: "text", name: "Login" } },
        { index: 2, action: "fill", target: { strategy: "label", name: "Username" }, valueKey: "user" },
        { index: 3, action: "click", target: { strategy: "text", name: "Submit" } },
        { index: 4, action: "assertVisible", target: { strategy: "text", name: "Welcome" } }
    ],
    createdAt: new Date().toISOString()
};
const sampleSnapshot = {
    version: "1.0",
    url: "https://example.com/dashboard",
    title: "Dashboard",
    capturedAt: new Date().toISOString(),
    elements: [
        { id: "btn-1", type: "button", text: "Login", visible: true, role: "button", candidateLocators: [], dataHints: [] },
        { id: "btn-2", type: "button", text: "Sign Up", visible: true, role: "button", candidateLocators: [], dataHints: [] },
        { id: "inp-1", type: "input", label: "Username", visible: true, role: "textbox", candidateLocators: [], dataHints: [] },
        { id: "lnk-1", type: "link", text: "Forgot password", visible: true, role: "link", candidateLocators: [], dataHints: [] },
        { id: "h1-1", type: "heading", text: "Dashboard", visible: true, role: "heading", candidateLocators: [], dataHints: [] }
    ],
    summary: { totalElements: 5, buttons: 2, links: 1, inputs: 1, selects: 0, tables: 0, dialogs: 0, headings: 1 }
};
const sampleContextPack = {
    version: "1.0",
    createdAt: new Date().toISOString(),
    app: { appSlug: "test-app" },
    failure: {},
    currentRun: { outputDir: "/tmp" },
    knownObjects: [
        { key: "obj-login", name: "Login Button", type: "button", confidence: 0.9 },
        { key: "obj-user", name: "Username Input", type: "input", confidence: 0.85 },
        { key: "obj-submit", name: "Submit Button", type: "button", confidence: 0.8 }
    ],
    knownPlans: [
        { id: "plan-1", title: "Login Flow", status: "active", score: 0.8 },
        { id: "plan-2", title: "Registration Flow", status: "active", score: 0.3 }
    ],
    knownRoutes: [
        { route: ["Login", "Username", "Submit"], sourcePlanId: "plan-1", score: 0.9 },
        { route: ["Sign Up", "Register", "Confirm"], sourcePlanId: "plan-2", score: 0.4 }
    ],
    snapshotCandidates: [],
    supportedActions: ["click", "fill", "navigate"],
    safeData: { availableKeys: ["user", "pass"], redacted: true },
    constraints: {
        codexMustOnlyWriteAgentResponseJson: true,
        doNotRunPlaywright: true,
        doNotModifyStableRegistry: true,
        doNotApproveObjectsAutomatically: true,
        doNotInventData: true
    },
    warnings: []
};
// --- deriveSemanticGoal tests ---
(0, test_1.test)("deriveSemanticGoal from scenario and pending steps", () => {
    const goal = (0, route_recovery_pack_1.deriveSemanticGoal)({ title: "Test", steps: [{ action: "click", target: "Login" }, { action: "fill", target: "Username" }] }, [{ action: "click", target: "Submit" }], [{ target: "Welcome" }], "Login");
    (0, test_1.expect)(goal.intent).toContain("click");
    (0, test_1.expect)(goal.targetConcept).toBe("Login");
    (0, test_1.expect)(goal.expectedOutcome).toBe("Welcome");
    (0, test_1.expect)(goal.sensitive).toBe(false);
});
(0, test_1.test)("deriveSemanticGoal marks sensitive for login/pay actions", () => {
    const goal = (0, route_recovery_pack_1.deriveSemanticGoal)({ title: "Pay", steps: [{ action: "pay", target: "Amount" }] }, [], [], undefined);
    (0, test_1.expect)(goal.sensitive).toBe(true);
});
(0, test_1.test)("deriveSemanticGoal returns unknown for empty inputs", () => {
    const goal = (0, route_recovery_pack_1.deriveSemanticGoal)(undefined, [], [], undefined);
    (0, test_1.expect)(goal.intent).toBe("unknown");
    (0, test_1.expect)(goal.targetConcept).toBeUndefined();
});
// --- buildRouteRecoveryPack tests ---
(0, test_1.test)("buildRouteRecoveryPack generates pack with correct version", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        failedAtStep: 1,
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack,
        scenario: { title: "Test", steps: [] }
    });
    (0, test_1.expect)(pack.version).toBe("1.0");
    (0, test_1.expect)(pack.failedAction.failureReason).toBe("target_not_found");
    (0, test_1.expect)(pack.failedAction.target).toBe("Login");
    (0, test_1.expect)(pack.semanticGoal.intent).toBeTruthy();
});
(0, test_1.test)("buildRouteRecoveryPack limits visible candidates to budget.maxCandidates", () => {
    const manyElements = {
        version: "1.0",
        url: "https://example.com",
        title: "Page",
        elements: Array.from({ length: 30 }, (_, i) => ({
            id: `el-${i}`, type: "button", text: `Item ${i}`, visible: true, role: "button", candidateLocators: [], dataHints: []
        })),
        capturedAt: new Date().toISOString(),
        summary: { totalElements: 30, buttons: 30, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 }
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Item 5",
        currentPlan: samplePlan,
        snapshot: manyElements,
        contextPack: sampleContextPack,
        budget: { maxCandidates: 10 }
    });
    (0, test_1.expect)(pack.topVisibleCandidates.length).toBeLessThanOrEqual(10);
});
(0, test_1.test)("buildRouteRecoveryPack limits known objects to budget.maxKnownObjects", () => {
    const manyObjects = {
        ...sampleContextPack,
        knownObjects: Array.from({ length: 50 }, (_, i) => ({
            key: `obj-${i}`, name: `Object ${i}`, type: "button", confidence: 0.5
        }))
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Object 1",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: manyObjects,
        budget: { maxKnownObjects: 15 }
    });
    (0, test_1.expect)(pack.topKnownObjects.length).toBeLessThanOrEqual(15);
});
(0, test_1.test)("buildRouteRecoveryPack limits known routes to budget.maxKnownRoutes", () => {
    const manyRoutes = {
        ...sampleContextPack,
        knownRoutes: Array.from({ length: 20 }, (_, i) => ({
            route: [`Step ${i}`], sourcePlanId: `plan-${i}`, score: 0.5
        }))
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Step 1",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: manyRoutes,
        budget: { maxKnownRoutes: 5 }
    });
    (0, test_1.expect)(pack.topKnownRoutes.length).toBeLessThanOrEqual(5);
});
(0, test_1.test)("buildRouteRecoveryPack limits known plans to budget.maxKnownPlans", () => {
    const manyPlans = {
        ...sampleContextPack,
        knownPlans: Array.from({ length: 20 }, (_, i) => ({
            id: `plan-${i}`, title: `Plan ${i}`, score: 0.5
        }))
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Plan 1",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: manyPlans,
        budget: { maxKnownPlans: 3 }
    });
    (0, test_1.expect)(pack.topKnownPlans.length).toBeLessThanOrEqual(3);
});
(0, test_1.test)("buildRouteRecoveryPack sorts visible candidates by score descending", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack
    });
    for (let i = 1; i < pack.topVisibleCandidates.length; i++) {
        (0, test_1.expect)(pack.topVisibleCandidates[i].score).toBeLessThanOrEqual(pack.topVisibleCandidates[i - 1].score);
    }
});
(0, test_1.test)("buildRouteRecoveryPack deduplicates candidates by id", () => {
    const duplicateSnapshot = {
        version: "1.0",
        url: "https://example.com",
        title: "Page",
        elements: [
            { id: "btn-1", type: "button", text: "Login", visible: true, role: "button", candidateLocators: [], dataHints: [] },
            { id: "btn-1", type: "button", text: "Login", visible: true, role: "button", candidateLocators: [], dataHints: [] }
        ],
        capturedAt: new Date().toISOString(),
        summary: { totalElements: 2, buttons: 2, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 }
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        currentPlan: samplePlan,
        snapshot: duplicateSnapshot,
        contextPack: sampleContextPack
    });
    const ids = pack.topVisibleCandidates.map((c) => c.id);
    (0, test_1.expect)(new Set(ids).size).toBe(ids.length);
});
(0, test_1.test)("buildRouteRecoveryPack includes semanticGoal", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack,
        scenario: { title: "Login Test", steps: [{ action: "click", target: "Login" }] }
    });
    (0, test_1.expect)(pack.semanticGoal).toBeDefined();
    (0, test_1.expect)(pack.semanticGoal.intent).toBeTruthy();
    (0, test_1.expect)(pack.semanticGoal.targetConcept).toBe("Login");
});
(0, test_1.test)("buildRouteRecoveryPack includes prior successful steps before failed step", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Submit",
        failedAtStep: 3,
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack
    });
    (0, test_1.expect)(pack.priorSuccessfulSteps.length).toBeGreaterThan(0);
    for (const step of pack.priorSuccessfulSteps) {
        (0, test_1.expect)(step.index).toBeLessThan(3);
    }
});
(0, test_1.test)("buildRouteRecoveryPack includes pending steps from failed step onward", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Submit",
        failedAtStep: 3,
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack
    });
    (0, test_1.expect)(pack.pendingSteps.length).toBeGreaterThan(0);
    const failedPending = pack.pendingSteps.find((s) => s.failureReason);
    (0, test_1.expect)(failedPending?.failureReason).toBe("target_not_found");
});
(0, test_1.test)("buildRouteRecoveryPack includes budget defaults", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack
    });
    (0, test_1.expect)(pack.budget.maxProposedActions).toBe(5);
    (0, test_1.expect)(pack.budget.preferredResponseSeconds).toBe(30);
    (0, test_1.expect)(pack.budget.maxPromptBudgetSeconds).toBe(60);
    (0, test_1.expect)(pack.budget.maxCandidates).toBe(12);
});
(0, test_1.test)("buildRouteRecoveryPack includes constraints", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack
    });
    (0, test_1.expect)(pack.constraints.doNotRunPlaywright).toBe(true);
    (0, test_1.expect)(pack.constraints.useOnlyIdsPresentInThisPack).toBe(true);
    (0, test_1.expect)(pack.constraints.doNotModifyStableRegistry).toBe(true);
    (0, test_1.expect)(pack.constraints.doNotInventData).toBe(true);
});
(0, test_1.test)("buildRouteRecoveryPack empty snapshot produces empty candidates", () => {
    const emptySnapshot = {
        version: "1.0",
        url: "https://example.com",
        title: "Empty",
        capturedAt: new Date().toISOString(),
        elements: [],
        summary: { totalElements: 0, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 }
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        currentPlan: samplePlan,
        snapshot: emptySnapshot,
        contextPack: sampleContextPack
    });
    (0, test_1.expect)(pack.topVisibleCandidates).toHaveLength(0);
});
(0, test_1.test)("buildRouteRecoveryPack no hardcoded domain texts in output", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack
    });
    const json = JSON.stringify(pack);
    (0, test_1.expect)(json).not.toContain("SauceDemo");
    (0, test_1.expect)(json).not.toContain("Kiosko");
    (0, test_1.expect)(json).not.toContain("Banco Santa Cruz");
});
(0, test_1.test)("computeRouteRecoveryPackStats returns correct counts", () => {
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        currentPlan: samplePlan,
        snapshot: sampleSnapshot,
        contextPack: sampleContextPack
    });
    const stats = (0, route_recovery_pack_1.computeRouteRecoveryPackStats)(pack);
    (0, test_1.expect)(stats.visibleCandidates).toBe(pack.topVisibleCandidates.length);
    (0, test_1.expect)(stats.knownObjects).toBe(pack.topKnownObjects.length);
    (0, test_1.expect)(stats.knownRoutes).toBe(pack.topKnownRoutes.length);
    (0, test_1.expect)(stats.knownPlans).toBe(pack.topKnownPlans.length);
});
// --- Semantic scoring and visible-first tests ---
(0, test_1.test)("visible candidate with exact match scores higher than unrelated candidate", () => {
    const snapshot = {
        version: "1.0",
        url: "https://example.com",
        title: "Page",
        capturedAt: new Date().toISOString(),
        elements: [
            { id: "btn-login", type: "button", text: "Login", visible: true, role: "button", candidateLocators: [], dataHints: [] },
            { id: "btn-other", type: "button", text: "Some unrelated text", visible: true, role: "button", candidateLocators: [], dataHints: [] }
        ],
        summary: { totalElements: 2, buttons: 2, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 }
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        snapshot,
        contextPack: sampleContextPack
    });
    const login = pack.topVisibleCandidates.find((c) => c.id === "btn-login");
    const other = pack.topVisibleCandidates.find((c) => c.id === "btn-other");
    (0, test_1.expect)(login?.score).toBeGreaterThan(other?.score ?? 0);
});
(0, test_1.test)("visible candidate with parent_category relation ranks high", () => {
    const snapshot = {
        version: "1.0",
        url: "https://example.com",
        title: "Page",
        capturedAt: new Date().toISOString(),
        elements: [
            // Parent category "Products" contains the target token "Products"
            { id: "btn-products", type: "button", text: "Products", visible: true, role: "button", candidateLocators: [], dataHints: [] },
            { id: "btn-unrelated", type: "button", text: "Settings", visible: true, role: "button", candidateLocators: [], dataHints: [] }
        ],
        summary: { totalElements: 2, buttons: 2, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 }
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Product List",
        snapshot,
        contextPack: sampleContextPack
    });
    const products = pack.topVisibleCandidates.find((c) => c.id === "btn-products");
    (0, test_1.expect)(products?.semanticRelation).toBe("parent_category");
    (0, test_1.expect)(products?.score).toBeGreaterThan(0);
});
(0, test_1.test)("non-actionable static candidate scores lower than actionable", () => {
    const snapshot = {
        version: "1.0",
        url: "https://example.com",
        title: "Page",
        capturedAt: new Date().toISOString(),
        elements: [
            { id: "btn-action", type: "button", text: "Submit", visible: true, role: "button", candidateLocators: [], dataHints: [] },
            { id: "txt-static", type: "text", text: "Submit", visible: true, role: "heading", candidateLocators: [], dataHints: [] }
        ],
        summary: { totalElements: 2, buttons: 1, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 1 }
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Submit",
        snapshot,
        contextPack: sampleContextPack
    });
    const actionBtn = pack.topVisibleCandidates.find((c) => c.id === "btn-action");
    const staticTxt = pack.topVisibleCandidates.find((c) => c.id === "txt-static");
    (0, test_1.expect)(actionBtn?.score).toBeGreaterThan(staticTxt?.score ?? 0);
});
(0, test_1.test)("knownObjects=0 and empty contextPack still produces pack with visibleCandidates", () => {
    const emptyContext = {
        version: "1.0",
        createdAt: new Date().toISOString(),
        app: { appSlug: "test" },
        failure: {},
        currentRun: { outputDir: "/tmp" },
        knownObjects: [],
        knownPlans: [],
        knownRoutes: [],
        snapshotCandidates: [],
        supportedActions: ["click"],
        safeData: { availableKeys: [], redacted: true },
        constraints: {
            codexMustOnlyWriteAgentResponseJson: true,
            doNotRunPlaywright: true,
            doNotModifyStableRegistry: true,
            doNotApproveObjectsAutomatically: true,
            doNotInventData: true
        },
        warnings: []
    };
    const pack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
        failedReason: "target_not_found",
        failedTarget: "Login",
        snapshot: sampleSnapshot,
        contextPack: emptyContext
    });
    (0, test_1.expect)(pack.topVisibleCandidates.length).toBeGreaterThan(0);
    (0, test_1.expect)(pack.topKnownObjects.length).toBe(0);
    (0, test_1.expect)(pack.topVisibleCandidates[0].source).toBe("current_snapshot");
});
