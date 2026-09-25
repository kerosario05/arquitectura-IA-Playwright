"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const promotion_gate_1 = require("./promotion-gate");
function buildPlan() {
    return {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        createdAt: new Date().toISOString(),
        scenario: {
            source: "manual",
            externalId: "PREVIEW-001",
            title: "Visualizacion inicial"
        },
        requiredData: [],
        steps: [
            { index: 1, action: "click", description: "Iniciar", target: { strategy: "text", value: "Iniciar" } },
            { index: 2, action: "assertVisible", description: "Validar boton iniciar", target: { strategy: "text", value: "Iniciar" }, expected: "Boton iniciar visible" }
        ]
    };
}
function buildCaseResult(overrides = {}) {
    return {
        version: "1.0",
        caseId: 0,
        caseTitle: "Escenario de prueba",
        discoveredAt: new Date().toISOString(),
        status: "discovered_passed",
        steps: [],
        discoveredObjects: [],
        candidatePlan: buildPlan(),
        ...overrides,
    };
}
(0, node_test_1.default)("required unsupported_or_unresolved oracle blocks promotion with clear reason", () => {
    const result = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: buildCaseResult(),
        candidatePlan: buildPlan(),
        observableOracles: [
            { requirement: "Descripción general del depósito", type: "literal_visible_text", backed: true },
            { requirement: "Tasas y beneficios mostrados", type: "unsupported_or_unresolved", backed: false },
        ],
    });
    node_assert_1.default.strictEqual(result.allowed, false);
    node_assert_1.default.ok(result.reasons.some((reason) => reason.includes("Required observable oracle unresolved")), `expected unresolved-oracle reason, got: ${result.reasons.join(" | ")}`);
    node_assert_1.default.strictEqual(result.status, "blocked");
});
(0, node_test_1.default)("backed literal_visible_text oracles do not block promotion", () => {
    const result = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: buildCaseResult(),
        candidatePlan: buildPlan(),
        observableOracles: [
            { requirement: "Descripción general del depósito", type: "literal_visible_text", backed: true },
            { requirement: "Tasas y beneficios mostrados", type: "literal_visible_text", backed: true },
        ],
    });
    node_assert_1.default.strictEqual(result.allowed, true);
    node_assert_1.default.ok(!result.reasons.some((reason) => reason.includes("Required observable oracle unresolved")), `unexpected unresolved-oracle reason, got: ${result.reasons.join(" | ")}`);
});
(0, node_test_1.default)("no unresolved oracles leaves promotion gate allowed", () => {
    const result = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: buildCaseResult(),
        candidatePlan: buildPlan(),
    });
    node_assert_1.default.strictEqual(result.allowed, true);
});
