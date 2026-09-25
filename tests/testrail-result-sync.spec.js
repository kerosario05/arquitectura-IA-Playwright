"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const testrail_result_sync_1 = require("../src/server/jobs/testrail-result-sync");
(0, test_1.test)("maps non-passed discovery statuses to failed in TestRail", () => {
    const failedStatusId = (0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("failed");
    (0, test_1.expect)((0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("skipped")).toBe(failedStatusId);
    (0, test_1.expect)((0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("review_needed")).toBe(failedStatusId);
    (0, test_1.expect)((0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("needs_agent")).toBe(failedStatusId);
    (0, test_1.expect)((0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("exploration_failed")).toBe(failedStatusId);
    (0, test_1.expect)((0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("error")).toBe(failedStatusId);
});
(0, test_1.test)("maps unknown statuses to failed in TestRail", () => {
    const failedStatusId = (0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("failed");
    (0, test_1.expect)((0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("unexpected_status")).toBe(failedStatusId);
    (0, test_1.expect)((0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("blocked")).toBe(failedStatusId);
});
(0, test_1.test)("maps blocked_infrastructure only when blocked mapping exists", () => {
    const previous = process.env.TESTRAIL_STATUS_BLOCKED_ID;
    try {
        delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
        (0, test_1.expect)((0, testrail_result_sync_1.hasInfrastructureBlockedStatusMapping)()).toBe(false);
        (0, test_1.expect)((0, testrail_result_sync_1.resolveInfrastructureBlockedStatusId)()).toBeUndefined();
        process.env.TESTRAIL_STATUS_BLOCKED_ID = "2";
        (0, test_1.expect)((0, testrail_result_sync_1.hasInfrastructureBlockedStatusMapping)()).toBe(true);
        (0, test_1.expect)((0, testrail_result_sync_1.resolveInfrastructureBlockedStatusId)()).toBe(2);
        (0, test_1.expect)((0, testrail_result_sync_1.mapDiscoveryStatusToTestRail)("blocked_infrastructure")).toBe(2);
    }
    finally {
        if (previous === undefined)
            delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
        else
            process.env.TESTRAIL_STATUS_BLOCKED_ID = previous;
    }
});
