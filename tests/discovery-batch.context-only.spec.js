"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const discovery_batch_1 = require("../src/cli/discovery-batch");
(0, test_1.test)("discovery-batch accepts context-only and forwards the opt-in value", () => {
    const contextOnlyArgs = (0, discovery_batch_1.parseBatchArgs)([
        "--case-ids", "123",
        "--app", "fixture-app",
        "--context-only",
    ]);
    (0, test_1.expect)(contextOnlyArgs.contextOnly).toBe(true);
    (0, test_1.expect)(contextOnlyArgs.caseIds).toEqual([123]);
    (0, test_1.expect)(contextOnlyArgs.app).toBe("fixture-app");
});
(0, test_1.test)("discovery-batch keeps context-only disabled by default", () => {
    (0, test_1.expect)((0, discovery_batch_1.parseBatchArgs)(["--case-ids", "123"]).contextOnly).toBe(false);
});
