"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const auth_variant_persister_1 = require("../src/knowledge/auth-variant-persister");
const TEST_SLUG = "test-auth-variant-temp";
function knowledgePath() { return node_path_1.default.join(process.cwd(), "automations", "apps", TEST_SLUG, "app.knowledge.json"); }
function clean() {
    try {
        const kp = knowledgePath();
        if (node_fs_1.default.existsSync(kp))
            node_fs_1.default.unlinkSync(kp);
        const dir = node_path_1.default.dirname(kp);
        if (node_fs_1.default.existsSync(dir) && node_fs_1.default.readdirSync(dir).length === 0)
            node_fs_1.default.rmdirSync(dir);
    }
    catch { }
}
test_1.test.beforeEach(() => clean());
test_1.test.afterEach(() => clean());
(0, test_1.test)("TEST1 pending without successEvidence", async () => {
    const item = await (0, auth_variant_persister_1.persistAuthVariant)(TEST_SLUG, {
        variantLabel: "Variant A",
        sourceScreenKey: "screen123",
        observedFieldsBefore: ["Field0"],
        observedFieldsAfter: ["Field1", "Field2"],
        requiredFieldsMatched: ["Field1", "Field2"],
    }, { phase: 1 });
    (0, test_1.expect)(item.validationStatus).toBe("pending");
    (0, test_1.expect)(item.trustedForReuse).toBe(false);
    (0, test_1.expect)(item.variantLabel).toBe("Variant A");
});
(0, test_1.test)("TEST2 same identity with successEvidence -> validated trusted", async () => {
    const first = await (0, auth_variant_persister_1.persistAuthVariant)(TEST_SLUG, {
        variantLabel: "Variant A",
        sourceScreenKey: "screen123",
        observedFieldsBefore: ["Field0"],
        observedFieldsAfter: ["Field1", "Field2"],
        requiredFieldsMatched: ["Field1", "Field2"],
    }, { phase: 1 });
    const second = await (0, auth_variant_persister_1.persistAuthVariant)(TEST_SLUG, {
        variantLabel: "Variant A",
        sourceScreenKey: "screen123",
        observedFieldsBefore: ["Field0"],
        observedFieldsAfter: ["Field1", "Field2"],
        requiredFieldsMatched: ["Field1", "Field2"],
        successEvidence: "auth_success_screen_abc",
    }, { phase: 2 });
    (0, test_1.expect)(second.id).toBe(first.id);
    (0, test_1.expect)(second.validationStatus).toBe("validated");
    (0, test_1.expect)(second.trustedForReuse).toBe(true);
    (0, test_1.expect)(second.successEvidence).toBe("auth_success_screen_abc");
});
(0, test_1.test)("TEST3 no secrets persisted", async () => {
    await (0, auth_variant_persister_1.persistAuthVariant)(TEST_SLUG, {
        variantLabel: "Variant A",
        sourceScreenKey: "screen123",
        observedFieldsBefore: ["password: supersecret123", "Token abc", "OTP 123456", "Field1"],
        observedFieldsAfter: ["Field1", "Field2"],
        requiredFieldsMatched: ["Field1"],
        successEvidence: "token_secret_should_not_leak",
    }, { phase: 1 });
    const raw = node_fs_1.default.readFileSync(knowledgePath(), "utf-8").toLowerCase();
    (0, test_1.expect)(raw.includes("supersecret")).toBe(false);
    (0, test_1.expect)(raw.includes("password")).toBe(false);
    (0, test_1.expect)(raw.includes("otp")).toBe(false);
    // token in variant fields should be filtered, but successEvidence containing token should be sanitized to undefined
    (0, test_1.expect)(raw.includes("token_secret_should_not_leak")).toBe(false);
    const list = (0, auth_variant_persister_1.listAuthVariantKnowledge)(TEST_SLUG);
    (0, test_1.expect)(list.length).toBe(1);
    const item = list[0];
    (0, test_1.expect)(String(item.successEvidence ?? "").toLowerCase().includes("token")).toBe(false);
});
(0, test_1.test)("TEST4 duplicate prevented same variant same screen", async () => {
    await (0, auth_variant_persister_1.persistAuthVariant)(TEST_SLUG, {
        variantLabel: "Variant A",
        sourceScreenKey: "screen123",
        observedFieldsBefore: ["A"],
        observedFieldsAfter: ["Field1", "Field2"],
        requiredFieldsMatched: ["Field1", "Field2"],
    }, { phase: 1 });
    await (0, auth_variant_persister_1.persistAuthVariant)(TEST_SLUG, {
        variantLabel: "Variant A",
        sourceScreenKey: "screen123",
        observedFieldsBefore: ["A"],
        observedFieldsAfter: ["Field1", "Field2"],
        requiredFieldsMatched: ["Field1", "Field2"],
    }, { phase: 1 });
    const list = (0, auth_variant_persister_1.listAuthVariantKnowledge)(TEST_SLUG);
    (0, test_1.expect)(list.length).toBe(1);
    (0, test_1.expect)(list[0].runCount).toBe(2);
});
