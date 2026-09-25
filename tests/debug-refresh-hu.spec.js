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
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const debug_1 = require("../src/server/routes/debug");
const SLUG = "refresh-hu-test";
const APP_DIR = path.join(process.cwd(), "automations", "apps", SLUG);
const KP = path.join(APP_DIR, "app.knowledge.json");
const ISSUE = {
    key: "HU-X",
    summary: "HU-X",
    description: 'El usuario debe seleccionar "Destino B". Para continuar debe seleccionar el boton Entrada A.',
    acceptanceCriteria: null,
    labels: [],
    components: [],
    status: "Open",
    issueType: "Story",
};
test_1.test.afterAll(() => {
    try {
        fs.rmSync(APP_DIR, { recursive: true, force: true });
    }
    catch {
        /* ignore */
    }
});
(0, test_1.test)("refresh-hu: deriva hu_declared + declared_path, materializa, sin duplicar, sin AI", async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
        logs.push(args.join(" "));
        origLog(...args);
    };
    let r1;
    let r2;
    try {
        r1 = await (0, debug_1.refreshHuDeclaredFromIssue)(SLUG, ISSUE);
        r2 = await (0, debug_1.refreshHuDeclaredFromIssue)(SLUG, ISSUE);
    }
    finally {
        console.log = origLog;
    }
    // Success + response shape
    (0, test_1.expect)(r1.success).toBe(true);
    (0, test_1.expect)(r1.appSlug).toBe(SLUG);
    (0, test_1.expect)(r1.issueKey).toBe("HU-X");
    (0, test_1.expect)(r1.derived).toBeGreaterThan(0);
    (0, test_1.expect)(r1.declaredPaths).toBe(1);
    // app.knowledge.json materializado
    const data = JSON.parse(fs.readFileSync(KP, "utf-8"));
    const declaredPath = data.items.find((i) => i.category === "declared_path");
    (0, test_1.expect)(declaredPath).toBeDefined();
    (0, test_1.expect)(declaredPath.steps).toHaveLength(2);
    (0, test_1.expect)(declaredPath.steps[0]).toMatchObject({
        order: 1,
        stepKind: "prerequisite",
        actionTarget: "Entrada A",
    });
    (0, test_1.expect)(declaredPath.steps[1]).toMatchObject({
        order: 2,
        stepKind: "branch_action",
        actionTarget: "Destino B",
    });
    // Authority: purely declarative
    (0, test_1.expect)(declaredPath.validationStatus).toBe("pending");
    (0, test_1.expect)(declaredPath.trustedForReuse).toBe(false);
    (0, test_1.expect)(declaredPath.executionBacked).toBe(false);
    (0, test_1.expect)(declaredPath.source).toBe("hu_declared");
    // hu_declared persisted (prerequisite item present)
    const prereq = data.items.find((i) => i.category === "prerequisite");
    (0, test_1.expect)(prereq).toBeDefined();
    (0, test_1.expect)(prereq.sourceIssueKey).toBe("HU-X");
    // Same issue regenerated → no duplication
    const data2 = JSON.parse(fs.readFileSync(KP, "utf-8"));
    (0, test_1.expect)(data2.items.filter((i) => i.category === "declared_path")).toHaveLength(1);
    (0, test_1.expect)(r2.deduped).toBeGreaterThanOrEqual(0);
    // No AI provider invoked
    (0, test_1.expect)(logs.some((l) => l.includes("[scenarios:ai]") || l.includes("[codex-cli]"))).toBe(false);
    console.log(`refresh-hu OK: derived=${r1.derived} declaredPaths=${r1.declaredPaths}`);
});
