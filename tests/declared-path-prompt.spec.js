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
const SLUG = "declared-path-prompt-test";
const DIR = path.join(process.cwd(), "automations", "apps", SLUG);
const KP = path.join(DIR, "app.knowledge.json");
function makePath(id, issueKey, steps) {
    return {
        id,
        source: "hu_declared",
        knowledgeKind: "hu_declared",
        category: "declared_path",
        sourceIssueKey: issueKey,
        associatedBranchId: "branch-b",
        steps: steps.map((s) => ({
            order: s.order,
            stepKind: s.order === 1 ? "prerequisite" : "branch_action",
            actionTarget: s.actionTarget,
            actionIntent: s.order === 1 ? "click" : "select_option",
        })),
        validationStatus: "pending",
        trustedForReuse: false,
        executionBacked: false,
    };
}
const CURRENT_ISSUE = {
    key: "HU-CURRENT",
    summary: "El usuario debe acceder a Destino B",
    description: "",
    acceptanceCriteria: null,
    labels: [],
    components: [],
    status: "Open",
    issueType: "Story",
};
function writeKnowledge(items) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(KP, JSON.stringify({
        version: 1, appSlug: SLUG,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items,
    }, null, 2), "utf-8");
}
test_1.test.afterAll(() => {
    try {
        fs.rmSync(DIR, { recursive: true, force: true });
    }
    catch {
        /* ignore */
    }
});
async function buildPrompt(items, functionalTargets) {
    writeKnowledge(items);
    const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([CURRENT_ISSUE], SLUG, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "catalog_listing_flow", undefined, undefined, undefined, { mainIntent: "catalog_listing_flow", subIntent: "standard", explicitRoutePath: [] }, undefined, undefined, functionalTargets);
    return messages.find((m) => m.role === "system")?.content ?? "";
}
(0, test_1.test)("Caso 1: path previo termina en functional target actual → incluido y ordenado", async () => {
    const items = [makePath("p1", "HU-PRIOR", [
            { order: 1, actionTarget: "Entrada A" },
            { order: 2, actionTarget: "Destino B" },
        ])];
    const system = await buildPrompt(items, ["Destino B"]);
    (0, test_1.expect)(system).toContain("DECLARED ORDERED PATHS");
    (0, test_1.expect)(system).toContain("NOT RUNTIME VALIDATED");
    const section = system.split("DECLARED ORDERED PATHS")[1] ?? "";
    const idx1 = section.indexOf("1. Entrada A");
    const idx2 = section.indexOf("2. Destino B");
    (0, test_1.expect)(idx1).toBeGreaterThan(-1);
    (0, test_1.expect)(idx2).toBeGreaterThan(idx1);
    console.log("Caso 1: path incluido, orden preservado");
});
(0, test_1.test)("Caso 2: functional target no coincide → path NO incluido", async () => {
    const items = [makePath("p1", "HU-PRIOR", [
            { order: 1, actionTarget: "Entrada A" },
            { order: 2, actionTarget: "Destino B" },
        ])];
    const system = await buildPrompt(items, ["Otro destino"]);
    (0, test_1.expect)(system).not.toContain("DECLARED ORDERED PATHS");
    (0, test_1.expect)(system).not.toContain("1. Entrada A");
    console.log("Caso 2: path excluido por target no coincidente");
});
(0, test_1.test)("Caso 3: declared_path de la propia HU actual → NO incluido (self-knowledge)", async () => {
    const items = [makePath("p-self", "HU-CURRENT", [
            { order: 1, actionTarget: "Entrada A" },
            { order: 2, actionTarget: "Destino B" },
        ])];
    const system = await buildPrompt(items, ["Destino B"]);
    (0, test_1.expect)(system).not.toContain("DECLARED ORDERED PATHS");
    console.log("Caso 3: self-knowledge excluido");
});
(0, test_1.test)("Caso 4: dos paths distintos terminan en el mismo target → ninguno, ambiguous", async () => {
    const items = [
        makePath("p1", "HU-1", [
            { order: 1, actionTarget: "Entrada A" },
            { order: 2, actionTarget: "Destino B" },
        ]),
        makePath("p2", "HU-2", [
            { order: 1, actionTarget: "Entrada X" },
            { order: 2, actionTarget: "Destino B" },
        ]),
    ];
    const system = await buildPrompt(items, ["Destino B"]);
    (0, test_1.expect)(system).not.toContain("DECLARED ORDERED PATHS");
    console.log("Caso 4: ambiguous_declared_path — ninguno seleccionado");
});
(0, test_1.test)("Caso 5: allowedExecutableClicks y autoridad no cambian", async () => {
    const items = [makePath("p1", "HU-PRIOR", [
            { order: 1, actionTarget: "Entrada A" },
            { order: 2, actionTarget: "Destino B" },
        ])];
    const system = await buildPrompt(items, ["Destino B"]);
    // La sección es explícitamente solo contexto, no autoridad
    (0, test_1.expect)(system).toContain("does not authorize execution");
    (0, test_1.expect)(system).not.toContain("allowedExecutableClicks");
    console.log("Caso 5: sin autoridad de ejecución");
});
(0, test_1.test)("Caso 6: prompt contiene pasos ordenados y marcado NOT RUNTIME VALIDATED", async () => {
    const items = [makePath("p1", "HU-PRIOR", [
            { order: 1, actionTarget: "Entrada A" },
            { order: 2, actionTarget: "Destino B" },
        ])];
    const system = await buildPrompt(items, ["Destino B"]);
    const section = system.split("## DECLARED ORDERED PATHS")[1] ?? "";
    (0, test_1.expect)(section).toContain("NOT RUNTIME VALIDATED");
    const idx1 = section.indexOf("1. Entrada A");
    const idx2 = section.indexOf("2. Destino B");
    (0, test_1.expect)(idx1).toBeGreaterThan(-1);
    (0, test_1.expect)(idx2).toBeGreaterThan(idx1);
    // No metadata: ids/timestamps/hashes ausentes
    (0, test_1.expect)(section).not.toContain("hd_declared_path");
    (0, test_1.expect)(section).not.toContain("createdAt");
    console.log("Caso 6: sección compacta, ordenada, NOT RUNTIME VALIDATED");
});
