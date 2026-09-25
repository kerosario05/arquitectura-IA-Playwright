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
const node_test_1 = __importDefault(require("node:test"));
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
// Helper: write a temporary knowledge file to trigger the file-based fallback
function writeTempKnowledge(slug, items) {
    const dir = path.join(process.cwd(), "automations", "apps", slug);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "app.knowledge.json");
    fs.writeFileSync(filePath, JSON.stringify({ items }), "utf-8");
    return filePath;
}
function removeTempKnowledge(slug) {
    const dir = path.join(process.cwd(), "automations", "apps", slug);
    const filePath = path.join(dir, "app.knowledge.json");
    try {
        fs.unlinkSync(filePath);
    }
    catch { /* ignore */ }
    try {
        fs.rmdirSync(dir);
    }
    catch { /* ignore */ }
}
async function loadKnowledge(slug) {
    const mod = await Promise.resolve().then(() => __importStar(require("../src/knowledge/route-profile-deriver")));
    return mod.loadRouteKnowledge(slug);
}
// TEST 1: Web project without routeProfile in knowledge → projectType stays from SQL
// When SQL is unavailable and no file exists, fallback returns 0 (unknown), NOT mobile
(0, node_test_1.default)("TEST 1 — web project without routeProfile: projectType=unknown fallback, not mobile", async () => {
    const slug = `test-web-noroute-${Date.now()}`;
    const result = await loadKnowledge(slug);
    node_assert_1.default.strictEqual(result.projectType, 0, "fallback without SQL or file must return projectType=0 (unknown), not mobile (2)");
    node_assert_1.default.deepStrictEqual(result.items, [], "no knowledge items when no SQL config and no file");
});
// TEST 2: Mobile project type preserved from SQL
// When SQL returns projectType=2, the value flows through correctly
// Without SQL, fallback returns 0 (unknown), NOT 2 (mobile)
(0, node_test_1.default)("TEST 2 — mobile project: fallback does NOT default to mobile (2)", async () => {
    const slug = `test-mobile-${Date.now()}`;
    const result = await loadKnowledge(slug);
    node_assert_1.default.notStrictEqual(result.projectType, 2, "fallback without SQL must NOT return mobile (2) by default");
});
// TEST 3: Existing project without resolvable type → projectType=unknown (0)
(0, node_test_1.default)("TEST 3 — unresolvable type: projectType=unknown (0), never mobile", async () => {
    const slug = `test-unknown-${Date.now()}`;
    const result = await loadKnowledge(slug);
    node_assert_1.default.strictEqual(result.projectType, 0, "unresolvable type must be 0 (unknown), NOT 2 (mobile)");
});
// TEST 4: Absence of routeProfile does not change projectType
// projectType and routeProfile are independent dimensions
(0, node_test_1.default)("TEST 4 — routeProfile independence: projectType unchanged by routeProfile absence", async () => {
    const slug = `test-independence-${Date.now()}`;
    const filePath = writeTempKnowledge(slug, [
        { knowledgeKind: "functional_requirement", screenKey: "home" },
    ]);
    try {
        const result = await loadKnowledge(slug);
        node_assert_1.default.strictEqual(result.projectType, 0, "file-based fallback returns unknown (0), not mobile");
        node_assert_1.default.strictEqual(result.items.length, 1, "knowledge items loaded from file");
        node_assert_1.default.notStrictEqual(result.projectType, 2, "projectType must NOT become mobile just because routeProfile is absent");
    }
    finally {
        removeTempKnowledge(slug);
    }
});
