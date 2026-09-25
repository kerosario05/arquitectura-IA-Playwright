"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const testrail_normalizer_1 = require("./testrail-normalizer");
(0, node_test_1.default)("does not assign custom_expected global to a free-text step", () => {
    const parsed = (0, testrail_normalizer_1.normalizeTestRailCase)({
        id: 9901,
        title: "Normal case",
        custom_steps: "1. Step one\n2. Step two\n3. Step three",
        custom_expected: "The flow succeeds",
    });
    strict_1.default.deepEqual(parsed.steps.map((step) => step.expected), [undefined, undefined, undefined]);
});
(0, node_test_1.default)("preserves expected values structurally attached to separated steps", () => {
    const parsed = (0, testrail_normalizer_1.normalizeTestRailCase)({
        id: 9902,
        title: "Separated case",
        custom_steps_separated: [
            { content: "Step one", expected: "First result" },
            { content: "Step two" },
            { content: "Step three", expected: "Third result" },
        ],
    });
    strict_1.default.deepEqual(parsed.steps.map((step) => step.expected), ["First result", undefined, "Third result"]);
});
