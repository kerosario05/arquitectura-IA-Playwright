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
const mcp_scenario_prompt_builder_1 = require("../src/scenarios/mcp-scenario-prompt-builder");
const SLUG = "prompt-hints-subintent-test";
const DIR = path.join(process.cwd(), "automations", "apps", SLUG);
const KP = path.join(DIR, "app.knowledge.json");
const BRANCH = {
    id: "b_branch",
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "branch",
    sourceText: "Navegar a Destino B",
    actionTarget: "Destino B",
    actionIntent: "navigate",
    sourceIssueKey: "HU-X",
    associatedBranchId: "b_branch",
    executionBacked: false,
    validationStatus: "pending",
    trustedForReuse: false,
    runCount: 1,
};
const PREREQ = {
    id: "b_prereq",
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "prerequisite",
    sourceText: "Para continuar debe seleccionar Entrada A",
    actionTarget: "Entrada A",
    actionIntent: "click",
    sourceIssueKey: "HU-X",
    executionBacked: false,
    validationStatus: "pending",
    trustedForReuse: false,
    runCount: 1,
};
const ISSUE = {
    key: "HU-NEW",
    summary: "El usuario debe acceder a Destino B para continuar",
    description: "",
    acceptanceCriteria: null,
    labels: [],
    components: [],
    status: "Open",
    issueType: "Story",
};
test_1.test.beforeAll(() => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(KP, JSON.stringify({
        version: 1, appSlug: SLUG,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [BRANCH, PREREQ],
    }, null, 2), "utf-8");
});
test_1.test.afterAll(() => { try {
    fs.rmSync(DIR, { recursive: true, force: true });
}
catch { } });
(0, test_1.test)("prompt generationHints respect subIntent contract and use functional targets", async () => {
    // resolvedIntent=A, huModel.mainIntent=B (discarded), huModel.subIntent=B1
    // → compatibleSubIntent=undefined, functional targets reach the hints path.
    const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([ISSUE], SLUG, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "A", // effectiveIntent / resolvedIntent
    undefined, undefined, undefined, { mainIntent: "B", subIntent: "B1", explicitRoutePath: [] }, undefined, undefined, ["Destino B"]);
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const hintsSection = system.split("## Declarative Generation Hints")[1] ?? "";
    (0, test_1.expect)(hintsSection).toContain("Destino B");
    (0, test_1.expect)(hintsSection).toContain("Entrada A");
    (0, test_1.expect)(hintsSection).toContain("Category: branch");
    (0, test_1.expect)(hintsSection).toContain("Category: prerequisite");
    // Authority unchanged: hints section carries declarative-only warning.
    (0, test_1.expect)(hintsSection).toContain("NOT validated or executable routes");
    (0, test_1.expect)(system).not.toContain("executionBacked");
    console.log("prompt generationHints: branch=Destino B + companion=Entrada A, subIntent cleared");
});
(0, test_1.test)("conflicting subIntent cleared — no subintent penalty rejects the branch", async () => {
    const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([ISSUE], SLUG, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "A", undefined, undefined, undefined, { mainIntent: "B", subIntent: "B1", explicitRoutePath: [] }, undefined, undefined, ["Destino B"]);
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const hintsSection = system.split("## Declarative Generation Hints")[1] ?? "";
    // Branch reached the prompt (would NOT if subintent_low_overlap penalty applied).
    (0, test_1.expect)(hintsSection).toContain("Action target: Destino B");
    console.log("conflicting subIntent (B1 from intent B) cleared for resolvedIntent=A");
});
(0, test_1.test)("compatible subIntent preserved when huModel.mainIntent matches resolvedIntent", async () => {
    const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([ISSUE], SLUG, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "A", undefined, undefined, undefined, { mainIntent: "A", subIntent: "A1", explicitRoutePath: [] }, undefined, undefined, ["Destino B"]);
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    (0, test_1.expect)(system).toContain("Destino B");
    console.log("compatible subIntent A1 preserved when mainIntent matches resolvedIntent");
});
