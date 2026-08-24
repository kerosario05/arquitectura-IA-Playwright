import { test, expect } from "@playwright/test";
import {
  hasInfrastructureBlockedStatusMapping,
  mapDiscoveryStatusToTestRail,
  resolveInfrastructureBlockedStatusId,
} from "../src/server/jobs/testrail-result-sync";

test("maps non-passed discovery statuses to failed in TestRail", () => {
  const failedStatusId = mapDiscoveryStatusToTestRail("failed");
  expect(mapDiscoveryStatusToTestRail("skipped")).toBe(failedStatusId);
  expect(mapDiscoveryStatusToTestRail("review_needed")).toBe(failedStatusId);
  expect(mapDiscoveryStatusToTestRail("needs_agent")).toBe(failedStatusId);
  expect(mapDiscoveryStatusToTestRail("exploration_failed")).toBe(failedStatusId);
  expect(mapDiscoveryStatusToTestRail("error")).toBe(failedStatusId);
});

test("maps unknown statuses to failed in TestRail", () => {
  const failedStatusId = mapDiscoveryStatusToTestRail("failed");
  expect(mapDiscoveryStatusToTestRail("unexpected_status")).toBe(failedStatusId);
  expect(mapDiscoveryStatusToTestRail("blocked")).toBe(failedStatusId);
});

test("maps blocked_infrastructure only when blocked mapping exists", () => {
  const previous = process.env.TESTRAIL_STATUS_BLOCKED_ID;
  try {
    delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    expect(hasInfrastructureBlockedStatusMapping()).toBe(false);
    expect(resolveInfrastructureBlockedStatusId()).toBeUndefined();

    process.env.TESTRAIL_STATUS_BLOCKED_ID = "2";
    expect(hasInfrastructureBlockedStatusMapping()).toBe(true);
    expect(resolveInfrastructureBlockedStatusId()).toBe(2);
    expect(mapDiscoveryStatusToTestRail("blocked_infrastructure")).toBe(2);
  } finally {
    if (previous === undefined) delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    else process.env.TESTRAIL_STATUS_BLOCKED_ID = previous;
  }
});
