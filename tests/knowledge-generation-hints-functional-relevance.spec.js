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
const SLUG = "gen-hints-functional-relevance-test";
const DIR = path.join(process.cwd(), "automations", "apps", SLUG);
const KP = path.join(DIR, "app.knowledge.json");
const BRANCH_B = {
    id: "prior_branch_b",
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "branch",
    sourceText: "Navegar a Destino B desde el menu principal",
    actionTarget: "Destino B",
    actionIntent: "navigate",
    sourceIssueKey: "HU-100",
    associatedBranchId: "branch_b",
    executionBacked: false,
    validationStatus: "pending",
    trustedForReuse: false,
    runCount: 1,
};
const PREREQ_GLOBAL = {
    id: "prior_prereq_global",
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "prerequisite",
    sourceText: "Para continuar debe seleccionar Entrada A",
    actionTarget: "Entrada A",
    actionIntent: "click",
    sourceIssueKey: "HU-100",
    executionBacked: false,
    validationStatus: "pending",
    trustedForReuse: false,
    runCount: 1,
};
const VISIBILITY = {
    id: "prior_visibility",
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "visibility",
    sourceText: "Se muestra el titulo de la pagina",
    actionTarget: "titulo de la pagina",
    actionIntent: "assert",
    sourceIssueKey: "HU-100",
    executionBacked: false,
    validationStatus: "pending",
    trustedForReuse: false,
    runCount: 1,
};
const RESTART = {
    id: "prior_restart",
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "restart",
    sourceText: "Reiniciar el flujo desde el inicio",
    actionTarget: "Reiniciar",
    actionIntent: "navigate",
    sourceIssueKey: "HU-100",
    executionBacked: false,
    validationStatus: "pending",
    trustedForReuse: false,
    runCount: 1,
};
const UNRELATED_RUNTIME = {
    id: "rt_validated",
    knowledgeKind: "route_menu_snapshot",
    validationStatus: "validated",
    trustedForReuse: true,
    clickTargets: ["Destino B", "Entrada A"],
    steps: ["Click menu", "Click Destino B"],
    failureCount: 0,
    successCount: 3,
};
const NEW_HU = "El usuario necesita acceder a Destino B para realizar una consulta";
test_1.test.beforeAll(() => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(KP, JSON.stringify({
        version: 1, appSlug: SLUG,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [BRANCH_B, PREREQ_GLOBAL, VISIBILITY, RESTART, UNRELATED_RUNTIME],
    }, null, 2), "utf-8");
});
test_1.test.afterAll(() => { try {
    fs.rmSync(DIR, { recursive: true, force: true });
}
catch { } });
(0, test_1.test)("Case 1: branch selected via functional target relevance — trusted=false/pending", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(SLUG, NEW_HU, "navigation", undefined, undefined, ["Destino B"]);
    const branch = ctx.generationHints.find((h) => h.actionTarget === "Destino B");
    (0, test_1.expect)(branch).toBeDefined();
    (0, test_1.expect)(branch.category).toBe("branch");
    (0, test_1.expect)(branch.score).toBeGreaterThanOrEqual(20);
    (0, test_1.expect)(branch.reason).toContain("functional_target_relevance");
    console.log(`Case 1: branch score=${branch.score} reason=${branch.reason}`);
});
(0, test_1.test)("Case 2: companion prerequisite included when branch selected", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(SLUG, NEW_HU, "navigation", undefined, undefined, ["Destino B"]);
    const branch = ctx.generationHints.find((h) => h.actionTarget === "Destino B");
    const prereq = ctx.generationHints.find((h) => h.actionTarget === "Entrada A");
    (0, test_1.expect)(branch).toBeDefined();
    (0, test_1.expect)(prereq).toBeDefined();
    (0, test_1.expect)(prereq.category).toBe("prerequisite");
    (0, test_1.expect)(prereq.reason).toBe("companion_prerequisite");
    (0, test_1.expect)(prereq.sourceIssueKey).toBe(branch.sourceIssueKey);
    (0, test_1.expect)(prereq.executionBacked).toBeUndefined();
    (0, test_1.expect)(prereq.trustedForReuse).toBeUndefined();
    (0, test_1.expect)(prereq.validationStatus).toBeUndefined();
    console.log(`Case 2: companion prereq reason=${prereq.reason}`);
});
(0, test_1.test)("Case 3: visibility/restart from same issue NOT included by companion closure", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(SLUG, NEW_HU, "navigation", undefined, undefined, ["Destino B"]);
    const visibility = ctx.generationHints.find((h) => h.category === "visibility");
    const restart = ctx.generationHints.find((h) => h.category === "restart");
    (0, test_1.expect)(visibility).toBeUndefined();
    (0, test_1.expect)(restart).toBeUndefined();
    console.log("Case 3: visibility and restart excluded from generationHints");
});
(0, test_1.test)("Case 4: target does not match branch — no branch or prerequisite selected", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(SLUG, NEW_HU, "navigation", undefined, undefined, ["Accion Irrelevante"]);
    const branch = ctx.generationHints.find((h) => h.actionTarget === "Destino B");
    const prereq = ctx.generationHints.find((h) => h.actionTarget === "Entrada A");
    (0, test_1.expect)(branch).toBeUndefined();
    (0, test_1.expect)(prereq).toBeUndefined();
    console.log("Case 4: no branch/prerequisite when no functional target match");
});
(0, test_1.test)("Case 5: allowedExecutableClicks and runtime authority not changed", () => {
    const ctx = (0, knowledge_context_resolver_1.buildKnowledgeContextForScenarioGeneration)(SLUG, NEW_HU, "navigation", undefined, undefined, ["Destino B"]);
    // generationHints never feed runtime tracks
    const runtimeKinds = [...ctx.navigationHints, ...ctx.functionalHints].map((h) => h.kind);
    (0, test_1.expect)(runtimeKinds).not.toContain("hu_declared");
    // generationHints carry only declarative fields — no execution authority
    for (const h of ctx.generationHints) {
        (0, test_1.expect)(typeof h.category).toBe("string");
        (0, test_1.expect)(typeof h.sourceText).toBe("string");
        (0, test_1.expect)(h.executionBacked).toBeUndefined();
        (0, test_1.expect)(h.clickTargets).toBeUndefined();
        (0, test_1.expect)(h.trustedForReuse).toBeUndefined();
        (0, test_1.expect)(h.validationStatus).toBeUndefined();
    }
    console.log("Case 5: runtime authority and allowedExecutableClicks unchanged");
});
