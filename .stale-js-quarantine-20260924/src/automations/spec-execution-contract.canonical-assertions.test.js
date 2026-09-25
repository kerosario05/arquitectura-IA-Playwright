"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const spec_execution_contract_1 = require("./spec-execution-contract");
const testrail_canonical_adapter_1 = require("../testrail/testrail-canonical-adapter");
(0, node_test_1.default)("round-trips canonical assertion parents into semantic contract steps", () => {
    const canonical = (0, testrail_canonical_adapter_1.canonicalizeTestRailCase)({
        id: 905,
        title: "Constrained transition",
        custom_steps_separated: [
            ...Array.from({ length: 12 }, (_, index) => ({ content: `Perform action ${index + 1}` })),
            { content: 'Al salir del campo "subject", validar que el campo quede inválido y que se muestre un mensaje asociado al dato.' },
            { content: 'Validar que, mientras el campo "subject" permanezca inválido, la acción "advance" permanezca deshabilitada y no permita continuar.' },
        ],
    });
    const source = {
        steps: canonical.steps.map((step) => ({
            index: step.order,
            action: step.action,
            expected: step.expected,
            requirementRefs: step.requirementRefs,
            canonicalAssertion: step.canonicalAssertion,
        })),
        requirements: canonical.requirements,
        stepRequirementRefs: canonical.steps.flatMap((step) => (step.requirementRefs ?? []).map((requirementId) => ({ stepIndex: step.order, requirementId }))),
    };
    const plan = {
        scenario: { externalId: "C905", title: canonical.title },
        steps: canonical.steps.map((step) => ({ index: step.order, action: "noop" })),
    };
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan, source);
    const step13 = contract.steps.find((step) => step.scenarioStepIndex === 13);
    const step14 = contract.steps.find((step) => step.scenarioStepIndex === 14);
    strict_1.default.equal(contract.diagnostics.requiredScenarioSteps, 14);
    strict_1.default.equal(contract.steps.length, 14);
    strict_1.default.equal(step13.operation, "assertState");
    strict_1.default.equal(step13.assertionIntent, "validation_present");
    strict_1.default.equal(step13.trigger, "leave_field");
    strict_1.default.equal(step13.childExpectations?.length, 2);
    strict_1.default.equal(step13.requirementRefs?.length, 1);
    strict_1.default.equal(step14.operation, "assertState");
    strict_1.default.equal(step14.assertionIntent, "transition_blocked");
    strict_1.default.equal(step13.polarity, "positive");
    strict_1.default.equal(step14.polarity, "negative");
    strict_1.default.equal(step14.condition, 'el campo "subject" permanezca inválido');
    strict_1.default.equal(step14.requirementRefs?.length, 1);
});
