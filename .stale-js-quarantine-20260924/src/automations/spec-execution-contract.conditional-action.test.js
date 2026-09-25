"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const spec_execution_contract_1 = require("./spec-execution-contract");
(0, node_test_1.default)("keeps a conditional action executable and optional in the contract", () => {
    const conditionalAction = {
        operation: "click",
        actionTarget: "Salir",
        condition: { type: "visibility", target: "Salir" },
        required: false,
        conditionalRequired: true,
        skipAllowedWhenConditionFalse: true,
    };
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)({
        scenario: { externalId: "C-test", title: "conditional" },
        steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Salir" }, optional: true, conditionalAction }],
    }, { title: "conditional", steps: [{ index: 1, action: "Si aparece, hacer clic", conditionalAction }] });
    strict_1.default.equal(contract.steps.length, 1);
    strict_1.default.equal(contract.steps[0]?.operation, "click");
    strict_1.default.equal(contract.steps[0]?.conditional, true);
    strict_1.default.equal(contract.steps[0]?.required, false);
    strict_1.default.notEqual(contract.steps[0]?.operation, "noop");
});
