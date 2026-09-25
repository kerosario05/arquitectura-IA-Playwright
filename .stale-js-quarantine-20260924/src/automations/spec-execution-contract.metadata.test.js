"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const spec_execution_contract_1 = require("./spec-execution-contract");
function buildPlan(target) {
    return {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 44757, externalId: "C44757", title: "Scenario" },
        requiredData: [],
        steps: [{ index: 6, action: "click", target: { strategy: "text", value: target }, description: `Clic en ${target}` }],
        createdAt: new Date().toISOString(),
    };
}
function buildRegistry(targetBinding) {
    return {
        version: "1.0",
        appSlug: "app",
        updatedAt: new Date().toISOString(),
        componentCandidates: [],
        pageObjects: [{
                id: "po",
                className: "ProductListPage",
                filePath: "pages/product-list.page.ts",
                screenSignature: "list",
                confidence: 1,
                status: "active",
                sourcePlanIds: [],
                caseIds: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                methods: [{
                        name: "clickPrimaryAction",
                        intent: "click_primary_action",
                        parameters: ["target"],
                        available: true,
                        source: "test",
                        sensitive: false,
                        confidence: 1,
                        status: "active",
                        targetBinding,
                    }],
            }],
    };
}
function contractFor(target, targetBinding) {
    return (0, spec_execution_contract_1.buildSpecExecutionContract)(buildPlan(target), { steps: [{ index: 6, action: `Clic en "${target}"` }] }, { pageObjectRegistry: buildRegistry(targetBinding) });
}
(0, node_test_1.default)("implementation metadata requires exact target binding for click steps", () => {
    const foreign = contractFor("Salir", "Continuar").steps[0];
    strict_1.default.equal(foreign.operation, "click");
    strict_1.default.equal(foreign.target?.value, "Salir");
    strict_1.default.equal(foreign.implementation, undefined);
    const matching = contractFor("Salir", "Salir").steps[0];
    strict_1.default.equal(matching.implementation?.owner, "ProductListPage");
    strict_1.default.equal(matching.implementation?.method, "clickPrimaryAction");
    const ambiguous = (0, spec_execution_contract_1.buildSpecExecutionContract)({
        ...buildPlan("Salir"),
        steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "Salir" } },
            { index: 2, action: "click", target: { strategy: "text", value: "Salir" } },
        ],
    }, { steps: [{ index: 9, action: 'Clic en "Salir"' }] }, { pageObjectRegistry: buildRegistry("Salir") }).steps[0];
    strict_1.default.equal(ambiguous.implementation, undefined);
});
