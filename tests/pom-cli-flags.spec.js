"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const discovery_case_1 = require("../src/cli/discovery-case");
const discovery_batch_1 = require("../src/cli/discovery-batch");
(0, test_1.test)("discovery:case --page-object-mode is default (true)", () => {
    const args = (0, discovery_case_1.parseDiscoveryCaseArgs)(["--case-id", "100"]);
    (0, test_1.expect)(args.pageObjectMode).toBe(true);
});
(0, test_1.test)("discovery:case --no-page-object-mode sets false", () => {
    const args = (0, discovery_case_1.parseDiscoveryCaseArgs)(["--case-id", "100", "--no-page-object-mode"]);
    (0, test_1.expect)(args.pageObjectMode).toBe(false);
});
(0, test_1.test)("discovery:case --inline-debug-spec sets true", () => {
    const args = (0, discovery_case_1.parseDiscoveryCaseArgs)(["--case-id", "100", "--inline-debug-spec"]);
    (0, test_1.expect)(args.inlineDebugSpec).toBe(true);
});
(0, test_1.test)("discovery:case --allow-page-object-candidates is default (true)", () => {
    const args = (0, discovery_case_1.parseDiscoveryCaseArgs)(["--case-id", "100"]);
    (0, test_1.expect)(args.allowPageObjectCandidates).toBe(true);
});
(0, test_1.test)("discovery:case --no-page-object-candidates sets false", () => {
    const args = (0, discovery_case_1.parseDiscoveryCaseArgs)(["--case-id", "100", "--no-page-object-candidates"]);
    (0, test_1.expect)(args.allowPageObjectCandidates).toBe(false);
});
(0, test_1.test)("discovery:batch --page-object-mode is default (true)", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "100"]);
    (0, test_1.expect)(args.pageObjectMode).toBe(true);
});
(0, test_1.test)("discovery:batch --no-page-object-mode sets false", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "100", "--no-page-object-mode"]);
    (0, test_1.expect)(args.pageObjectMode).toBe(false);
});
(0, test_1.test)("discovery:batch --inline-debug-spec sets true", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "100", "--inline-debug-spec"]);
    (0, test_1.expect)(args.inlineDebugSpec).toBe(true);
});
(0, test_1.test)("discovery:batch --allow-page-object-candidates is default (true)", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "100"]);
    (0, test_1.expect)(args.allowPageObjectCandidates).toBe(true);
});
(0, test_1.test)("discovery:batch --no-page-object-candidates sets false", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "100", "--no-page-object-candidates"]);
    (0, test_1.expect)(args.allowPageObjectCandidates).toBe(false);
});
(0, test_1.test)("discovery:case existing flags still work with POM flags", () => {
    const args = (0, discovery_case_1.parseDiscoveryCaseArgs)([
        "--case-id", "500",
        "--headed",
        "--auto-promote",
        "--promotion-dry-run",
        "--page-object-mode",
        "--inline-debug-spec"
    ]);
    (0, test_1.expect)(args.caseId).toBe(500);
    (0, test_1.expect)(args.headed).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.promotionDryRun).toBe(true);
    (0, test_1.expect)(args.pageObjectMode).toBe(true);
    (0, test_1.expect)(args.inlineDebugSpec).toBe(true);
});
(0, test_1.test)("discovery:batch existing flags still work with POM flags", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)([
        "--case-ids", "100,200",
        "--headed",
        "--auto-promote",
        "--auto-repair",
        "--no-page-object-mode"
    ]);
    (0, test_1.expect)(args.caseIds).toEqual([100, 200]);
    (0, test_1.expect)(args.headed).toBe(true);
    (0, test_1.expect)(args.autoPromote).toBe(true);
    (0, test_1.expect)(args.autoRepair).toBe(true);
    (0, test_1.expect)(args.pageObjectMode).toBe(false);
});
