"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const spec_execution_contract_1 = require("./spec-execution-contract");
function buildContract(oracles) {
    return (0, spec_execution_contract_1.buildSpecExecutionContract)({ scenario: { title: "fixture" }, steps: [] }, {
        steps: oracles.map((oracle) => ({
            index: oracle.stepIndex,
            action: "assert state",
            expected: "fixture expectation",
        })),
        observableOracles: oracles.map((oracle) => ({
            id: `oracle-${oracle.stepIndex}`,
            requirement: "fixture expectation",
            type: "navigation_transition",
            backed: true,
            source: "discovery",
            stepIndex: oracle.stepIndex,
            polarity: oracle.polarity,
            evidence: [],
        })),
    });
}
(0, node_test_1.default)("negative and positive oracle polarity reach their matching contract steps", () => {
    const contract = buildContract([
        { stepIndex: 1, polarity: "negative" },
        { stepIndex: 2, polarity: "positive" },
    ]);
    strict_1.default.equal(contract.steps[0]?.oracle?.polarity, "negative");
    strict_1.default.equal(contract.steps[1]?.oracle?.polarity, "positive");
});
(0, node_test_1.default)("undefined oracle polarity remains undefined", () => {
    const contract = buildContract([{ stepIndex: 1 }]);
    strict_1.default.equal(contract.steps[0]?.oracle?.polarity, undefined);
});
