"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const auth_variant_discovery_1 = require("../src/discovery/auth-variant-discovery");
const auth_variant_persister_1 = require("../src/knowledge/auth-variant-persister");
const SLUG = "test-variant-discovery-temp";
function kp() { return node_path_1.default.join(process.cwd(), "automations", "apps", SLUG, "app.knowledge.json"); }
function clean() { try {
    const p = kp();
    if (node_fs_1.default.existsSync(p))
        node_fs_1.default.unlinkSync(p);
    const d = node_path_1.default.dirname(p);
    if (node_fs_1.default.existsSync(d) && node_fs_1.default.readdirSync(d).length === 0)
        node_fs_1.default.rmdirSync(d);
}
catch { } }
test_1.test.beforeEach(() => clean());
test_1.test.afterEach(() => clean());
(0, test_1.test)("TEST1 Variant B only fulfills requiredFields -> pending", async () => {
    const required = ["Company ID", "User", "Password"];
    const before = ["User", "Password"];
    const candidates = [
        { variantLabel: "Variant A", sourceScreenKey: "screen1", observedFieldsAfter: ["User", "Password"], role: "tab" },
        { variantLabel: "Variant B", sourceScreenKey: "screen1", observedFieldsAfter: ["Company ID", "User", "Password"], role: "tab" },
    ];
    const selected = (0, auth_variant_discovery_1.selectPendingVariants)(required, before, candidates);
    (0, test_1.expect)(selected.length).toBe(1);
    (0, test_1.expect)(selected[0].variantLabel).toBe("Variant B");
    // persist via discoverAndPersistPendingVariant with mock deps
    const snapshotBefore = { screenKey: "screen1", inputLabels: before, observedControls: [{ label: "Variant A", role: "tab" }, { label: "Variant B", role: "tab" }] };
    const afterMap = {
        "Variant A": { screenKey: "screen1", inputLabels: ["User", "Password"] },
        "Variant B": { screenKey: "screen1", inputLabels: ["Company ID", "User", "Password"] },
    };
    const result = await (0, auth_variant_discovery_1.discoverAndPersistPendingVariant)(SLUG, snapshotBefore, required, {
        getCandidates: (snap) => [{ variantLabel: "Variant A", sourceScreenKey: "screen1", role: "tab" }, { variantLabel: "Variant B", sourceScreenKey: "screen1", role: "tab" }],
        clickCandidate: async (c) => afterMap[c.variantLabel],
        restoreState: async () => snapshotBefore,
    });
    (0, test_1.expect)(result.persisted).toBe(1);
    const list = (0, auth_variant_persister_1.listAuthVariantKnowledge)(SLUG);
    (0, test_1.expect)(list.length).toBe(1);
    (0, test_1.expect)(list[0].variantLabel).toBe("Variant B");
    (0, test_1.expect)(list[0].validationStatus).toBe("pending");
    (0, test_1.expect)(list[0].trustedForReuse).toBe(false);
});
(0, test_1.test)("TEST2 ambiguous generic buttons -> 0 clicks", async () => {
    const required = ["RNC", "Usuario"];
    const before = ["Usuario"];
    const candidates = [
        { variantLabel: "Forgot password", sourceScreenKey: "s1", observedFieldsAfter: ["Usuario"], role: "button" },
        { variantLabel: "Help", sourceScreenKey: "s1", observedFieldsAfter: ["Usuario"], role: "button" },
    ];
    // isSafe should be false for button
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "button", label: "Forgot password" })).toBe(false);
    const selected = (0, auth_variant_discovery_1.selectPendingVariants)(required, before, candidates);
    (0, test_1.expect)(selected.length).toBe(0);
    const snapshotBefore = { screenKey: "s1", inputLabels: before };
    const result = await (0, auth_variant_discovery_1.discoverAndPersistPendingVariant)(SLUG, snapshotBefore, required, {
        getCandidates: (snap) => [{ variantLabel: "Forgot password", sourceScreenKey: "s1", role: "button" }, { variantLabel: "Help", sourceScreenKey: "s1", role: "button" }],
        clickCandidate: async () => { throw new Error("should not click"); },
        restoreState: async () => snapshotBefore,
    });
    (0, test_1.expect)(result.persisted).toBe(0);
    (0, test_1.expect)(result.failClosed).toBe(true);
    (0, test_1.expect)((0, auth_variant_persister_1.listAuthVariantKnowledge)(SLUG).length).toBe(0);
});
(0, test_1.test)("TEST3 A fails restore then B satisfies -> only B persisted", async () => {
    const required = ["Company ID", "User", "Password"];
    const before = ["User"];
    const snapshotBefore = { screenKey: "screen1", inputLabels: before };
    const afterMap = {
        "Variant A": { screenKey: "screen1", inputLabels: ["User"] },
        "Variant B": { screenKey: "screen1", inputLabels: ["Company ID", "User", "Password"] },
    };
    let restoreCalls = 0;
    const result = await (0, auth_variant_discovery_1.discoverAndPersistPendingVariant)(SLUG, snapshotBefore, required, {
        getCandidates: (snap) => [{ variantLabel: "Variant A", sourceScreenKey: "screen1", role: "tab" }, { variantLabel: "Variant B", sourceScreenKey: "screen1", role: "tab" }],
        clickCandidate: async (c) => afterMap[c.variantLabel],
        restoreState: async () => { restoreCalls++; return snapshotBefore; },
    });
    (0, test_1.expect)(result.persisted).toBe(1);
    (0, test_1.expect)(restoreCalls).toBe(2); // after each candidate
    const list = (0, auth_variant_persister_1.listAuthVariantKnowledge)(SLUG);
    (0, test_1.expect)(list.length).toBe(1);
    (0, test_1.expect)(list[0].variantLabel).toBe("Variant B");
    (0, test_1.expect)(list[0].validationStatus).toBe("pending");
});
