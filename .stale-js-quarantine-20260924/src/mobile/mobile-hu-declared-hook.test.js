"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
function test(label, fn) {
    Promise.resolve()
        .then(fn)
        .then(() => console.log(`  PASS  ${label}`))
        .catch((err) => {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
// ── Setup temp project directory ──────────────────────────────────────────
const tmpRoot = node_path_1.default.join(node_os_1.default.tmpdir(), `mobile-hu-declared-test-${Date.now()}`);
const testAppSlug = "test-mobile";
const testAppDir = node_path_1.default.join(tmpRoot, "automations", "apps", testAppSlug);
function setupProject() {
    node_fs_1.default.mkdirSync(testAppDir, { recursive: true });
    node_fs_1.default.writeFileSync(node_path_1.default.join(testAppDir, "app.knowledge.json"), JSON.stringify({ version: 1, appSlug: testAppSlug, items: [] }), "utf-8");
}
const originalCwd = process.cwd;
describe("Mobile hu_declared persistence via shared persister", () => {
    setupProject();
    process.cwd = () => tmpRoot;
    test("TEST 1 — first run creates hu_declared items in app.knowledge.json", async () => {
        const { buildRequirementAccounting } = await Promise.resolve().then(() => __importStar(require("../../src/scenarios/scenario-functional-quality")));
        const { persistHuDeclaredKnowledge } = await Promise.resolve().then(() => __importStar(require("../../src/knowledge/hu-declared-persister")));
        const huText = "El usuario debe poder iniciar sesion con credenciales validas";
        const requirementAccounting = buildRequirementAccounting([], [], huText, "MOB-TEST");
        const result = await persistHuDeclaredKnowledge(testAppSlug, requirementAccounting, [], "MOB-TEST");
        node_assert_1.default.ok(result.derived > 0, "must derive at least 1 item");
        node_assert_1.default.ok(result.inserted > 0, "must insert at least 1 item");
        node_assert_1.default.strictEqual(result.success, true, "must succeed");
        // Verify items in app.knowledge.json
        const raw = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(testAppDir, "app.knowledge.json"), "utf-8"));
        const items = raw.items ?? [];
        const huItems = items.filter((i) => i.source === "hu_declared" && i.sourceIssueKey === "MOB-TEST");
        node_assert_1.default.ok(huItems.length > 0, "must have hu_declared items for MOB-TEST");
        const firstItem = huItems[0];
        node_assert_1.default.strictEqual(firstItem.source, "hu_declared", "source must be hu_declared");
        node_assert_1.default.strictEqual(firstItem.validationStatus, "pending", "validationStatus must be pending");
        node_assert_1.default.strictEqual(firstItem.trustedForReuse, false, "trustedForReuse must be false");
        node_assert_1.default.strictEqual(firstItem.executionBacked, false, "executionBacked must be false");
    });
    test("TEST 2 — second run same HU does not duplicate items", async () => {
        const { buildRequirementAccounting } = await Promise.resolve().then(() => __importStar(require("../../src/scenarios/scenario-functional-quality")));
        const { persistHuDeclaredKnowledge } = await Promise.resolve().then(() => __importStar(require("../../src/knowledge/hu-declared-persister")));
        const huText = "El usuario debe poder iniciar sesion con credenciales validas";
        const requirementAccounting = buildRequirementAccounting([], [], huText, "MOB-TEST");
        const beforeRaw = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(testAppDir, "app.knowledge.json"), "utf-8"));
        const beforeCount = beforeRaw.items.length;
        const result = await persistHuDeclaredKnowledge(testAppSlug, requirementAccounting, [], "MOB-TEST");
        const afterRaw = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(testAppDir, "app.knowledge.json"), "utf-8"));
        const afterCount = afterRaw.items.length;
        node_assert_1.default.strictEqual(afterCount, beforeCount, "item count must not increase on duplicate run");
        node_assert_1.default.ok(result.deduped > 0 || result.updated > 0, "must dedup or update existing items");
    });
    test("TEST 3 — items are readable by loadMobileKnowledge (app.knowledge.json)", async () => {
        const { loadMobileKnowledge } = await Promise.resolve().then(() => __importStar(require("../../src/mobile/mobile-knowledge-resolver")));
        const knowledge = loadMobileKnowledge(testAppSlug);
        const huItems = knowledge.items.filter((i) => i.source === "hu_declared");
        node_assert_1.default.ok(huItems.length > 0, "loadMobileKnowledge must see hu_declared items from app.knowledge.json");
    });
});
// Cleanup
try {
    node_fs_1.default.rmSync(tmpRoot, { recursive: true, force: true });
}
catch { }
process.cwd = originalCwd;
console.log("\nAll tests completed.");
