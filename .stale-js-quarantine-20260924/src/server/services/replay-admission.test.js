"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const replay_admission_1 = require("./replay-admission");
const requested = ["Primary", "Repeat", "Zero", "Alternative"];
const rejection = (scenarioId) => ({ scenarioId, reasons: ["MUTATION_NO_EFFECT"] });
(0, node_test_1.default)("admission excludes an unrelated generation rejection", () => {
    const result = (0, replay_admission_1.resolveReplayAdmission)({
        requestedScenarioIds: requested,
        evaluatedScenarioIds: requested,
        eligibleScenarioIds: requested,
        admittedScenarioIds: requested,
        evaluatedRejectedScenarios: [],
        nonRequestedRejectedCandidates: [rejection("FIELD_OMISSION")],
    });
    strict_1.default.equal(result.requestedCount, 4);
    strict_1.default.equal(result.eligibleCount, 4);
    strict_1.default.equal(result.acceptedCount, 4);
    strict_1.default.equal(result.requestedRejectedCount, 0);
    strict_1.default.deepEqual(result.requestedRejectedScenarioIds, []);
    strict_1.default.deepEqual(result.nonRequestedRejectedCandidates.map(({ scenarioId }) => scenarioId), ["FIELD_OMISSION"]);
});
(0, node_test_1.default)("admission reports only the requested scenario that is not admitted", () => {
    const result = (0, replay_admission_1.resolveReplayAdmission)({
        requestedScenarioIds: requested,
        evaluatedScenarioIds: requested,
        eligibleScenarioIds: requested.slice(0, 3),
        admittedScenarioIds: requested.slice(0, 3),
        evaluatedRejectedScenarios: [rejection("Alternative")],
        nonRequestedRejectedCandidates: [rejection("FIELD_OMISSION")],
    });
    strict_1.default.equal(result.acceptedCount, 3);
    strict_1.default.deepEqual(result.requestedRejectedScenarioIds, ["Alternative"]);
    strict_1.default.deepEqual(result.nonRequestedRejectedCandidates.map(({ scenarioId }) => scenarioId), ["FIELD_OMISSION"]);
});
(0, node_test_1.default)("an invalid non-requested generated scenario does not change execution counts", () => {
    const result = (0, replay_admission_1.resolveReplayAdmission)({
        requestedScenarioIds: requested,
        evaluatedScenarioIds: requested,
        eligibleScenarioIds: requested,
        admittedScenarioIds: requested,
        evaluatedRejectedScenarios: [],
        nonRequestedRejectedCandidates: [rejection("GeneratedInvalid")],
    });
    strict_1.default.deepEqual({
        requestedCount: result.requestedCount,
        eligibleCount: result.eligibleCount,
        acceptedCount: result.acceptedCount,
        requestedRejectedCount: result.requestedRejectedCount,
        requestedRejectedScenarioIds: result.requestedRejectedScenarioIds,
    }, {
        requestedCount: 4,
        eligibleCount: 4,
        acceptedCount: 4,
        requestedRejectedCount: 0,
        requestedRejectedScenarioIds: [],
    });
});
(0, node_test_1.default)("a requested scenario must be evaluated before it can be a replay rejection", () => {
    const result = (0, replay_admission_1.resolveReplayAdmission)({
        requestedScenarioIds: requested,
        evaluatedScenarioIds: requested.slice(0, 3),
        eligibleScenarioIds: requested.slice(0, 3),
        admittedScenarioIds: requested.slice(0, 3),
        evaluatedRejectedScenarios: [rejection("Alternative")],
    });
    strict_1.default.equal(result.acceptedCount, 3);
    strict_1.default.equal(result.requestedRejectedCount, 0);
    strict_1.default.deepEqual(result.requestedRejectedScenarioIds, []);
    strict_1.default.deepEqual(result.nonRequestedRejectedCandidates, []);
});
