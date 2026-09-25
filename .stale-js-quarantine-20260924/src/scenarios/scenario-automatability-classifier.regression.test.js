"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const scenario_automatability_classifier_1 = require("./scenario-automatability-classifier");
function scenario(overrides = {}) {
    return {
        sourceIssueKey: "synthetic-case",
        title: "Validar cédula con formato erróneo al agregar empleado manualmente",
        steps: [
            'Hacer clic en la opción "Gestión de nómina".',
            'Hacer clic en la opción "Crear Manualmente".',
            'Validar que se muestre una validación asociada al documento inválido.',
        ],
        preconditions: [],
        expectedResult: "La validación se muestra en la interfaz.",
        type: "Functional",
        database: "QA",
        isConverted: 0,
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        appSlug: "synthetic-app",
        routeProfile: "",
        dataRequirements: "",
        nonExecutableCriteria: "",
        mcpExecutable: true,
        ...overrides,
    };
}
(0, node_test_1.default)("business use of manual language remains UI-automatable", () => {
    const result = (0, scenario_automatability_classifier_1.classifyScenarioAutomatability)(scenario());
    strict_1.default.equal(result.isAutomatable, true);
    strict_1.default.equal(result.reasonCode, "automatable_ui");
});
(0, node_test_1.default)("explicit manual-only authority still blocks automation", () => {
    const result = (0, scenario_automatability_classifier_1.classifyScenarioAutomatability)(scenario({
        title: "Validación de documento",
        steps: ["Ejecutar el caso manual-only."],
        manualOnly: true,
    }));
    strict_1.default.equal(result.isAutomatable, false);
    strict_1.default.equal(result.classification, "non_automatable_manual");
    strict_1.default.equal(result.reasonCode, "manual_only_metadata");
});
(0, node_test_1.default)("manual validation intent remains supported as an explicit free-text rule", () => {
    const result = (0, scenario_automatability_classifier_1.classifyScenarioAutomatability)(scenario({
        title: "Validación manual",
        steps: ["Validar manualmente la pantalla visible."],
    }));
    strict_1.default.equal(result.isAutomatable, false);
    strict_1.default.equal(result.reasonCode, "manual_rule_match");
});
