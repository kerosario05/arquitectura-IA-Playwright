"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const spec_execution_contract_1 = require("../src/automations/spec-execution-contract");
function contractWithImplementation(implementation) {
    return {
        version: "1.0",
        scenarioId: "POM-BINDING",
        title: "POM binding",
        steps: [{
                contractStepIndex: 0,
                scenarioStepIndex: 0,
                originalText: "start session",
                operation: "click",
                executionStatus: "executed",
                implementation,
                evidenceRefs: []
            }],
        unresolvedRequiredOracles: [],
        diagnostics: {
            requiredScenarioSteps: 1,
            representedScenarioSteps: 1,
            missingScenarioSteps: []
        }
    };
}
(0, node_test_1.describe)("POM binding contract", () => {
    (0, node_test_1.it)("rejects a zero-argument method represented with an argument", () => {
        const result = (0, spec_execution_contract_1.validateSpecExecutionContract)(contractWithImplementation({
            kind: "page_object",
            owner: "HomePage",
            method: "start",
            argument: "Start",
            expectedArgs: 0,
            semanticActionIdentity: "start_session"
        }));
        strict_1.default.ok(result.errors.includes("page_object_method_signature_mismatch:HomePage.start:expectedArgs=0:actualArgs=1"));
    });
    (0, node_test_1.it)("rejects a page-object binding without semantic identity", () => {
        const result = (0, spec_execution_contract_1.validateSpecExecutionContract)(contractWithImplementation({
            kind: "page_object",
            owner: "HomePage",
            method: "start",
            expectedArgs: 0
        }));
        strict_1.default.ok(result.errors.includes("page_object_method_semantic_mismatch:step=0:missing_action_identity"));
    });
});
