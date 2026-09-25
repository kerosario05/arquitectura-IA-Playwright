"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const case_discovery_1 = require("./case-discovery");
const unresolvedOracleContract = {
    pendingBlockingActions: [],
    pendingCriticalAssertions: ["structured assertion"],
    unresolvedContextualAssertions: [],
    satisfiedByEquivalentEvidence: [],
    destinationConfirmed: true,
};
(0, node_test_1.default)("completed exploration with unresolved oracle stays promotability-blocked, not exploration_failed", () => {
    const result = (0, case_discovery_1.resolveDiscoveryStatusFromAssertionContract)({
        initialStatus: "discovered_partial",
        unresolvedBlockingFailuresCount: 0,
        pendingDiscoveryCount: 1,
        someFound: true,
        contract: unresolvedOracleContract,
    });
    strict_1.default.equal(result.status, "discovered_partial");
    strict_1.default.notEqual(result.status, "exploration_failed");
    strict_1.default.equal(result.shouldExecuteFunctionalGate, false);
});
(0, node_test_1.default)("genuine target/runtime failure remains exploration_failed", () => {
    const result = (0, case_discovery_1.resolveDiscoveryStatusFromAssertionContract)({
        initialStatus: "exploration_failed",
        unresolvedBlockingFailuresCount: 1,
        pendingDiscoveryCount: 0,
        someFound: true,
        failedReason: "target_not_found",
        contract: {
            pendingBlockingActions: ["next action"],
            pendingCriticalAssertions: [],
            unresolvedContextualAssertions: [],
            satisfiedByEquivalentEvidence: [],
            destinationConfirmed: false,
        },
    });
    strict_1.default.equal(result.status, "exploration_failed");
    strict_1.default.equal(result.decisionReason, "hard_blocking_reason");
});
