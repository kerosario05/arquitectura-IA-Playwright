import assert from "node:assert/strict";
import test from "node:test";
import { resolveDiscoveryStatusFromAssertionContract } from "./case-discovery";

const unresolvedOracleContract = {
  pendingBlockingActions: [],
  pendingCriticalAssertions: ["structured assertion"],
  unresolvedContextualAssertions: [],
  satisfiedByEquivalentEvidence: [],
  destinationConfirmed: true,
};

test("completed exploration with unresolved oracle stays promotability-blocked, not exploration_failed", () => {
  const result = resolveDiscoveryStatusFromAssertionContract({
    initialStatus: "discovered_partial",
    unresolvedBlockingFailuresCount: 0,
    pendingDiscoveryCount: 1,
    someFound: true,
    contract: unresolvedOracleContract,
  });
  assert.equal(result.status, "discovered_partial");
  assert.notEqual(result.status, "exploration_failed");
  assert.equal(result.shouldExecuteFunctionalGate, false);
});

test("genuine target/runtime failure remains exploration_failed", () => {
  const result = resolveDiscoveryStatusFromAssertionContract({
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
  assert.equal(result.status, "exploration_failed");
  assert.equal(result.decisionReason, "hard_blocking_reason");
});
