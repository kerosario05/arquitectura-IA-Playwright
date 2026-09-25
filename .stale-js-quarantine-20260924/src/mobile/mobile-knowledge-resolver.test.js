"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const mobile_knowledge_resolver_1 = require("./mobile-knowledge-resolver");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
const tmpRoot = node_path_1.default.join(node_os_1.default.tmpdir(), `mobile-knowledge-test-${Date.now()}`);
function setupApp(slug, knowledgeContent) {
    const appDir = node_path_1.default.join(tmpRoot, "automations", "apps", slug);
    node_fs_1.default.mkdirSync(appDir, { recursive: true });
    if (knowledgeContent) {
        node_fs_1.default.writeFileSync(node_path_1.default.join(appDir, "app.knowledge.json"), JSON.stringify(knowledgeContent), "utf-8");
    }
}
const originalCwd = process.cwd;
console.log("\nloadMobileKnowledge — reads from app.knowledge.json");
test("TEST 1 — app.knowledge.json with items=[] returns empty, no crash", () => {
    const slug = "test-empty";
    setupApp(slug, { version: 1, appSlug: slug, items: [] });
    process.cwd = () => tmpRoot;
    try {
        const result = (0, mobile_knowledge_resolver_1.loadMobileKnowledge)(slug);
        node_assert_1.default.deepStrictEqual(result.items, [], "items must be empty array");
    }
    finally {
        process.cwd = originalCwd;
    }
});
test("TEST 2 — app.knowledge.json with hu_declared item returns it", () => {
    const slug = "test-hu-declared";
    const item = {
        id: "k1",
        source: "hu_declared",
        knowledgeKind: "screen_observed",
        clickTargets: ["btn_login"],
        assertionTargets: ["pantalla_inicio"],
        trustedForReuse: false,
        validationStatus: "pending",
        runCount: 0,
    };
    setupApp(slug, { version: 1, appSlug: slug, items: [item] });
    process.cwd = () => tmpRoot;
    try {
        const result = (0, mobile_knowledge_resolver_1.loadMobileKnowledge)(slug);
        node_assert_1.default.strictEqual(result.items.length, 1, "must return 1 item");
        node_assert_1.default.strictEqual(result.items[0].id, "k1", "item id must match");
        node_assert_1.default.strictEqual(result.items[0].source, "hu_declared", "item source must be hu_declared");
    }
    finally {
        process.cwd = originalCwd;
    }
});
test("TEST 3 — mobile.knowledge.json item is NOT read when app.knowledge.json is empty", () => {
    const slug = "test-mobile-isolation";
    const appDir = node_path_1.default.join(tmpRoot, "automations", "apps", slug);
    node_fs_1.default.mkdirSync(appDir, { recursive: true });
    // Write app.knowledge.json with empty items
    node_fs_1.default.writeFileSync(node_path_1.default.join(appDir, "app.knowledge.json"), JSON.stringify({
        version: 1, appSlug: slug, items: []
    }), "utf-8");
    // Write mobile.knowledge.json with an item (should be IGNORED)
    node_fs_1.default.writeFileSync(node_path_1.default.join(appDir, "mobile.knowledge.json"), JSON.stringify({
        items: [{ id: "mobile-only", knowledgeKind: "screen_observed", clickTargets: ["x"] }]
    }), "utf-8");
    process.cwd = () => tmpRoot;
    try {
        const result = (0, mobile_knowledge_resolver_1.loadMobileKnowledge)(slug);
        node_assert_1.default.strictEqual(result.items.length, 0, "must NOT read mobile.knowledge.json items");
    }
    finally {
        process.cwd = originalCwd;
    }
});
test("TEST 4 — missing app.knowledge.json returns empty, no crash", () => {
    const slug = "test-missing";
    setupApp(slug); // no knowledge file
    process.cwd = () => tmpRoot;
    try {
        const result = (0, mobile_knowledge_resolver_1.loadMobileKnowledge)(slug);
        node_assert_1.default.deepStrictEqual(result.items, [], "items must be empty array");
    }
    finally {
        process.cwd = originalCwd;
    }
});
// Cleanup
try {
    node_fs_1.default.rmSync(tmpRoot, { recursive: true, force: true });
}
catch { }
console.log("\nAll tests completed.");
