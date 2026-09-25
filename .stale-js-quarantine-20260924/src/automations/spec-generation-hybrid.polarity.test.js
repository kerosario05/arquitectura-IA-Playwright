"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const spec_generation_hybrid_1 = require("./spec-generation-hybrid");
const oracle = (polarity, stepIndex, id) => ({
    id,
    requirement: "sanitized requirement",
    type: "navigation_transition",
    backed: true,
    source: "scenario",
    stepIndex,
    polarity,
    target: "dashboard",
    evidence: [],
    details: { expectedUrl: "/dashboard" },
});
(0, node_test_1.default)("preserves negative polarity on the promoted implementation", () => {
    const [implementation] = (0, spec_generation_hybrid_1.buildPromotedOracleImplementations)([oracle("negative", 7, "negative")], null);
    strict_1.default.equal(implementation.polarity, "negative");
    strict_1.default.equal(implementation.expectedUrlPattern, "/dashboard");
    strict_1.default.equal(implementation.scenarioStepIndex, 7);
});
(0, node_test_1.default)("preserves positive polarity independently on another step", () => {
    const implementations = (0, spec_generation_hybrid_1.buildPromotedOracleImplementations)([
        oracle("negative", 7, "negative"),
        oracle("positive", 8, "positive"),
    ], null);
    strict_1.default.equal(implementations[1].polarity, "positive");
    strict_1.default.equal(implementations[1].scenarioStepIndex, 8);
    strict_1.default.equal(implementations[0].polarity, "negative");
});
(0, node_test_1.default)("fails closed when a URL oracle has unresolved polarity", () => {
    strict_1.default.throws(() => (0, spec_generation_hybrid_1.buildPromotedOracleImplementations)([oracle(undefined, 7, "unresolved")], null), /PROMOTED_ORACLE_POLARITY_UNRESOLVED/);
});
(0, node_test_1.default)("does not require polarity for an unrelated runtime oracle", () => {
    const [implementation] = (0, spec_generation_hybrid_1.buildPromotedOracleImplementations)([{
            id: "runtime",
            requirement: "sanitized requirement",
            type: "runtime_state",
            backed: true,
            source: "scenario",
            stepIndex: 8,
            evidence: [],
        }], null);
    strict_1.default.equal(implementation.polarity, undefined);
});
(0, node_test_1.default)("materializes isolated polarity and expected URL into generated assertion calls", () => {
    const implementations = (0, spec_generation_hybrid_1.buildPromotedOracleImplementations)([
        oracle("negative", 7, "negative"),
        oracle("positive", 8, "positive"),
    ], null);
    const source = [
        "await promotedRuntime.expectPromotedVisible({ stepIndex: 7, target: 'A', assertion: async () => {} });",
        "await promotedRuntime.expectPromotedVisible({ stepIndex: 8, target: 'B', assertion: async () => {} });",
    ].join("\n");
    const result = (0, spec_generation_hybrid_1.materializePromotedOracleDescriptors)(source, implementations);
    strict_1.default.match(result, /stepIndex: 7[\s\S]*polarity: "negative"[\s\S]*expectedUrl: "\/dashboard"/);
    strict_1.default.match(result, /stepIndex: 8[\s\S]*polarity: "positive"[\s\S]*expectedUrl: "\/dashboard"/);
});
(0, node_test_1.default)("does not materialize an unresolved URL oracle", () => {
    const implementation = {
        ...(0, spec_generation_hybrid_1.buildPromotedOracleImplementations)([oracle("negative", 7, "negative")], null)[0],
        polarity: undefined,
    };
    strict_1.default.throws(() => (0, spec_generation_hybrid_1.materializePromotedOracleDescriptors)("await promotedRuntime.expectPromotedVisible({ stepIndex: 7, assertion: async () => {} });", [implementation]), /PROMOTED_ORACLE_POLARITY_UNRESOLVED/);
});
