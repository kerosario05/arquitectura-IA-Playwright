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
const knowledge_context_resolver_1 = require("../src/scenarios/knowledge-context-resolver");
const TEST_SLUG = "knowledge-gen-hints-test";
const KNOWLEDGE_DIR = path.join(process.cwd(), "automations", "apps", TEST_SLUG);
const KNOWLEDGE_PATH = path.join(KNOWLEDGE_DIR, "app.knowledge.json");
// Generic fixtures — not tied to any real app, HU key, product or business.
const HU_DECLARED_PREREQ = {
    id: "hd_prerequisite_1",
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "prerequisite",
    sourceText: "Para continuar debe seleccionar el boton Consultar saldo",
    sourceIssueKey: "GEN-1",
    associatedBranchId: "b1",
    expectedBehavior: "Avanzar requiere Consultar saldo",
    actionTarget: "Consultar saldo",
    actionIntent: "select",
    executionBacked: false,
    validationStatus: "pending",
    trustedForReuse: false,
    runCount: 1,
};
const HU_DECLARED_LOW_SCORE = {
    id: "hd_branch_2",
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "branch",
    sourceText: "El usuario accede a una seccion remota del area corporativa",
    sourceIssueKey: "GEN-2",
    expectedBehavior: "Acceder a una seccion remota",
    actionTarget: "Seccion remota lejana",
    actionIntent: "navigate",
    executionBacked: false,
    validationStatus: "pending",
    trustedForReuse: false,
    runCount: 1,
};
const VALIDATED_RUNTIME = {
    id: "scenario_validated_1",
    knowledgeKind: "scenario_validated",
    validationStatus: "validated",
    trustedForReuse: true,
    scenarioTitle: "Flujo base validado",
    steps: ["Consultar saldo de la cuenta", "Verificar saldo visible"],
    clickTargets: ["Consultar saldo", "Ingresar"],
    failureCount: 0,
    successCount: 2,
};
const TEST_HU = "El usuario necesita consultar el saldo de su cuenta corriente. Para continuar debe seleccionar el boton Consultar saldo.";
test_1.test.beforeAll(() => {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify({
        version: 1,
        appSlug: TEST_SLUG,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [HU_DECLARED_PREREQ, HU_DECLARED_LOW_SCORE, VALIDATED_RUNTIME],
    }, null, 2), "utf-8");
});
test_1.test.afterAll(() => {
    try {
        fs.rmSync(KNOWLEDGE_DIR, { recursive: true, force: true });
    }
    catch {
        /* ignore */
    }
});
(0, test_1.test)("hu_declared pending/trusted=false with sufficient score enters generationHints", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(TEST_SLUG, TEST_HU, "balance_inquiry");
    const hints = ctx.generationHints;
    const prereq = hints.find((h) => h.actionTarget === "Consultar saldo");
    (0, test_1.expect)(prereq).toBeDefined();
    (0, test_1.expect)(prereq.category).toBe("prerequisite");
    (0, test_1.expect)(prereq.actionIntent).toBe("select");
    (0, test_1.expect)(prereq.sourceText).toContain("Consultar saldo");
    (0, test_1.expect)(prereq.score).toBeGreaterThanOrEqual(20);
});
(0, test_1.test)("same hu_declared item does NOT enter runtime authority", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(TEST_SLUG, TEST_HU, "balance_inquiry");
    const runtimeKinds = [...ctx.navigationHints, ...ctx.functionalHints].map((h) => h.kind);
    (0, test_1.expect)(runtimeKinds.includes("hu_declared")).toBe(false);
    // The only runtime hint comes from the validated item — none from hu_declared.
    (0, test_1.expect)(ctx.navigationHints.length).toBe(0);
    (0, test_1.expect)(ctx.functionalHints.length).toBe(1);
    (0, test_1.expect)(ctx.functionalHints[0].kind).toBe("scenario_validated");
});
(0, test_1.test)("validated/runtime item keeps existing behavior", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(TEST_SLUG, TEST_HU, "balance_inquiry");
    (0, test_1.expect)(ctx.available).toBe(true);
    (0, test_1.expect)(ctx.functionalHints.length).toBeGreaterThan(0);
    const validated = ctx.functionalHints.find((h) => h.kind === "scenario_validated");
    (0, test_1.expect)(validated).toBeDefined();
    (0, test_1.expect)(validated.clickTargets).toContain("Consultar saldo");
});
(0, test_1.test)("hu_declared item with low score is not selected", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(TEST_SLUG, TEST_HU, "balance_inquiry");
    (0, test_1.expect)(ctx.generationHints.some((h) => h.actionTarget === "Seccion remota lejana")).toBe(false);
});
(0, test_1.test)("generationHints never feed allowedExecutableClicks/runtime track", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(TEST_SLUG, TEST_HU, "balance_inquiry");
    // generationHints carry ONLY declarative fields — never execution authority.
    for (const h of ctx.generationHints) {
        (0, test_1.expect)(h.category.length).toBeGreaterThan(0);
        (0, test_1.expect)(typeof h.sourceText).toBe("string");
        (0, test_1.expect)(typeof h.score).toBe("number");
        (0, test_1.expect)(h.executionBacked).toBeUndefined();
        (0, test_1.expect)(h.trustedForReuse).toBeUndefined();
        (0, test_1.expect)(h.validationStatus).toBeUndefined();
        (0, test_1.expect)(h.clickTargets).toBeUndefined();
    }
    // hu_declared kind never appears in the runtime hint tracks that drive
    // allowedExecutableClicks / executable clicks.
    const runtimeKinds = [...ctx.navigationHints, ...ctx.functionalHints].map((h) => h.kind);
    (0, test_1.expect)(runtimeKinds.includes("hu_declared")).toBe(false);
});
