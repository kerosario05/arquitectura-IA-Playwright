"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const discovery_batch_1 = require("../src/cli/discovery-batch");
// --- parseBatchArgs tests ---
(0, test_1.test)("parseBatchArgs: --all sets mode=all", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    (0, test_1.expect)(args.mode).toBe("all");
});
(0, test_1.test)("parseBatchArgs: --app sets app slug override", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--app", "app-a"]);
    (0, test_1.expect)(args.app).toBe("app-a");
});
(0, test_1.test)("parseBatchArgs: --not-automated sets mode=not-automated", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--not-automated"]);
    (0, test_1.expect)(args.mode).toBe("not-automated");
});
(0, test_1.test)("parseBatchArgs: --case-ids parses comma-separated IDs", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "1,2,3"]);
    (0, test_1.expect)(args.mode).toBe("by-ids");
    (0, test_1.expect)(args.caseIds).toEqual([1, 2, 3]);
});
(0, test_1.test)("parseBatchArgs: --case-ids strips C prefix", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "C101,C102"]);
    (0, test_1.expect)(args.caseIds).toEqual([101, 102]);
});
(0, test_1.test)("parseBatchArgs: --from and --to set range", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--from", "100", "--to", "200"]);
    (0, test_1.expect)(args.mode).toBe("by-range");
    (0, test_1.expect)(args.from).toBe(100);
    (0, test_1.expect)(args.to).toBe(200);
});
(0, test_1.test)("parseBatchArgs: --from strips C prefix", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--from", "C100", "--to", "C200"]);
    (0, test_1.expect)(args.from).toBe(100);
    (0, test_1.expect)(args.to).toBe(200);
});
(0, test_1.test)("parseBatchArgs: --limit sets limit", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--limit", "5"]);
    (0, test_1.expect)(args.limit).toBe(5);
});
(0, test_1.test)("parseBatchArgs: --headed sets headed", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--headed"]);
    (0, test_1.expect)(args.headed).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --dry-run sets dryRun", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--dry-run"]);
    (0, test_1.expect)(args.dryRun).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --include-active sets includeActive", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--include-active"]);
    (0, test_1.expect)(args.includeActive).toBe(true);
    (0, test_1.expect)(args.rerunActive).toBe(false);
});
(0, test_1.test)("parseBatchArgs: --rerun-active enables includeActive and rerunActive", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--rerun-active"]);
    (0, test_1.expect)(args.includeActive).toBe(true);
    (0, test_1.expect)(args.rerunActive).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --stop-on-fail sets stopOnFail", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--stop-on-fail"]);
    (0, test_1.expect)(args.stopOnFail).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --auto-promote sets autoPromote", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--auto-promote"]);
    (0, test_1.expect)(args.autoPromote).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --concurrency without --parallel is forced to 1", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--concurrency", "3"]);
    (0, test_1.expect)(args.concurrency).toBe(1);
});
(0, test_1.test)("parseBatchArgs: --concurrency with --parallel allows value", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--parallel", "--concurrency", "3"]);
    (0, test_1.expect)(args.concurrency).toBe(3);
});
(0, test_1.test)("parseBatchArgs: --auto-repair sets autoRepair", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--auto-repair"]);
    (0, test_1.expect)(args.autoRepair).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --repair-timeout-ms 120000 sets repairTimeoutMs", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--auto-repair", "--repair-timeout-ms", "120000"]);
    (0, test_1.expect)(args.repairTimeoutMs).toBe(120000);
});
(0, test_1.test)("parseBatchArgs: sin --repair-timeout-ms usa default 120000", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    (0, test_1.expect)(args.repairTimeoutMs).toBe(120000);
});
(0, test_1.test)("parseBatchArgs: sin --auto-repair autoRepair es false", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    (0, test_1.expect)(args.autoRepair).toBe(false);
});
(0, test_1.test)("parseBatchArgs: --show-agent-log sets showAgentLog", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--show-agent-log"]);
    (0, test_1.expect)(args.showAgentLog).toBe(true);
});
(0, test_1.test)("parseBatchArgs: default continueOnAgentTimeout is true", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    (0, test_1.expect)(args.continueOnAgentTimeout).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --continue-on-agent-timeout sets continueOnAgentTimeout", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--continue-on-agent-timeout"]);
    (0, test_1.expect)(args.continueOnAgentTimeout).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --compact-agent-prompt sets compactAgentPrompt", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--compact-agent-prompt"]);
    (0, test_1.expect)(args.compactAgentPrompt).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --agent-prompt-budget-seconds 45 sets budget", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--agent-prompt-budget-seconds", "45"]);
    (0, test_1.expect)(args.agentPromptBudgetSeconds).toBe(45);
});
(0, test_1.test)("parseBatchArgs: --agent-prompt-budget-seconds missing value throws", () => {
    (0, test_1.expect)(() => (0, discovery_batch_1.parseBatchArgs)(["--all", "--agent-prompt-budget-seconds"])).toThrow("Missing value");
});
(0, test_1.test)("parseBatchArgs: --agent-max-candidates 8 sets maxCandidates", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--agent-max-candidates", "8"]);
    (0, test_1.expect)(args.agentMaxCandidates).toBe(8);
});
(0, test_1.test)("parseBatchArgs: --agent-max-proposed-actions 3 sets maxProposedActions", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--agent-max-proposed-actions", "3"]);
    (0, test_1.expect)(args.agentMaxProposedActions).toBe(3);
});
(0, test_1.test)("parseBatchArgs: --agent-max-attempts 1 sets maxAttempts", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--agent-max-attempts", "1"]);
    (0, test_1.expect)(args.agentMaxAttempts).toBe(1);
});
(0, test_1.test)("parseBatchArgs: --headed with --concurrency > 1 forces concurrency=1", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--headed", "--concurrency", "5"]);
    (0, test_1.expect)(args.headed).toBe(true);
    (0, test_1.expect)(args.concurrency).toBe(1);
});
(0, test_1.test)("parseBatchArgs: --headed alone keeps default concurrency=1", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--headed"]);
    (0, test_1.expect)(args.concurrency).toBe(1);
});
(0, test_1.test)("parseBatchArgs: --promotion-strict and --require-promotion-approval parsed", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--promotion-strict", "--require-promotion-approval"]);
    (0, test_1.expect)(args.promotionStrict).toBe(true);
    (0, test_1.expect)(args.requirePromotionApproval).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --promotion-dry-run sets promotionDryRun", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--promotion-dry-run"]);
    (0, test_1.expect)(args.promotionDryRun).toBe(true);
});
(0, test_1.test)("parseBatchArgs: --case-ids with missing value throws", () => {
    (0, test_1.expect)(() => (0, discovery_batch_1.parseBatchArgs)(["--case-ids"])).toThrow("Missing value");
});
(0, test_1.test)("parseBatchArgs: --limit with missing value throws", () => {
    (0, test_1.expect)(() => (0, discovery_batch_1.parseBatchArgs)(["--all", "--limit"])).toThrow("Missing value");
});
(0, test_1.test)("parseBatchArgs: --concurrency with missing value throws", () => {
    (0, test_1.expect)(() => (0, discovery_batch_1.parseBatchArgs)(["--all", "--concurrency"])).toThrow("Missing value");
});
(0, test_1.test)("parseBatchArgs: --from with missing value throws", () => {
    (0, test_1.expect)(() => (0, discovery_batch_1.parseBatchArgs)(["--from"])).toThrow("Missing value");
});
(0, test_1.test)("parseBatchArgs: --to without --from defaults to mode=all", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--to", "200"]);
    (0, test_1.expect)(args.mode).toBe("all");
    (0, test_1.expect)(args.to).toBe(200);
});
(0, test_1.test)("parseBatchArgs: --all and --not-automated conflicting modes throw", () => {
    (0, test_1.expect)(() => (0, discovery_batch_1.parseBatchArgs)(["--all", "--not-automated"])).toThrow("Mode already set");
});
(0, test_1.test)("parseBatchArgs: --all and --case-ids conflicting modes throw", () => {
    (0, test_1.expect)(() => (0, discovery_batch_1.parseBatchArgs)(["--all", "--case-ids", "1,2"])).toThrow("Mode already set");
});
(0, test_1.test)("parseBatchArgs: unknown argument throws", () => {
    (0, test_1.expect)(() => (0, discovery_batch_1.parseBatchArgs)(["--unknown-flag"])).toThrow("Unknown argument");
});
(0, test_1.test)("parseBatchArgs: --overwrite sets overwrite=true", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--overwrite"]);
    (0, test_1.expect)(args.overwrite).toBe(true);
});
(0, test_1.test)("parseBatchArgs: default overwrite is false", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    (0, test_1.expect)(args.overwrite).toBe(false);
});
(0, test_1.test)("parseBatchArgs: --parallel sets parallel=true", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--parallel"]);
    (0, test_1.expect)(args.parallel).toBe(true);
});
(0, test_1.test)("parseBatchArgs: default parallel is false", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    (0, test_1.expect)(args.parallel).toBe(false);
});
(0, test_1.test)("parseBatchArgs: --parallel with --concurrency 2 allows concurrency>1", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--parallel", "--concurrency", "2"]);
    (0, test_1.expect)(args.parallel).toBe(true);
    (0, test_1.expect)(args.concurrency).toBe(2);
});
(0, test_1.test)("parseBatchArgs: --concurrency without --parallel defaults to 1", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--concurrency", "3"]);
    (0, test_1.expect)(args.parallel).toBe(false);
    (0, test_1.expect)(args.concurrency).toBe(1);
});
(0, test_1.test)("parseBatchArgs: --headed forces parallel=false", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--headed", "--parallel", "--concurrency", "3"]);
    (0, test_1.expect)(args.headed).toBe(true);
    (0, test_1.expect)(args.parallel).toBe(false);
    (0, test_1.expect)(args.concurrency).toBe(1);
});
(0, test_1.test)("parseBatchArgs: default concurrency is 1", () => {
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    (0, test_1.expect)(args.concurrency).toBe(1);
});
// --- filter test cases (replicates selectCases filtering logic) ---
function filterTestCases(rawCases, statusMap, args) {
    let filtered = [...rawCases];
    if (args.mode === "by-range" && args.from !== undefined && args.to !== undefined) {
        filtered = filtered.filter((c) => c.id >= args.from && c.id <= args.to);
    }
    else if (args.mode === "by-ids" && args.caseIds.length > 0) {
        const idSet = new Set(args.caseIds);
        filtered = filtered.filter((c) => idSet.has(c.id));
    }
    const entries = [];
    for (const tc of filtered) {
        const status = statusMap.get(tc.id) ?? "not_automated";
        if (args.mode === "not-automated" && status !== "not_automated") {
            entries.push({
                caseId: tc.id,
                title: tc.title,
                selected: false,
                skipReason: "not_not_automated",
                status: "skipped_filter",
                promoted: false
            });
            continue;
        }
        if (!args.includeActive && status === "active") {
            entries.push({
                caseId: tc.id,
                title: tc.title,
                selected: false,
                activeAtSelection: true,
                skipReason: "already_active",
                status: "skipped_active",
                promoted: false
            });
            continue;
        }
        entries.push({
            caseId: tc.id,
            title: tc.title,
            selected: true,
            activeAtSelection: status === "active",
            status: "selected",
            promoted: false
        });
    }
    const selectedEntries = entries.filter((e) => e.selected);
    if (args.limit !== undefined && args.limit > 0 && selectedEntries.length > args.limit) {
        const kept = selectedEntries.slice(0, args.limit);
        const removed = selectedEntries.slice(args.limit);
        for (const r of removed) {
            const idx = entries.indexOf(r);
            if (idx !== -1) {
                entries[idx] = { ...entries[idx], selected: false, skipReason: "limit_reached", status: "skipped_filter" };
            }
        }
    }
    return entries;
}
function makeCase(id, title) {
    return { id, title, milestone_id: null, custom_steps_separated: [], refs: undefined };
}
(0, test_1.test)("filterTestCases: --case-ids filters to matching IDs", () => {
    const cases = [makeCase(1, "Case 1"), makeCase(2, "Case 2"), makeCase(3, "Case 3")];
    const statuses = new Map([[1, "not_automated"], [2, "active"], [3, "not_automated"]]);
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "1,3"]);
    const entries = filterTestCases(cases, statuses, args);
    (0, test_1.expect)(entries).toHaveLength(2);
    (0, test_1.expect)(entries.every((e) => e.selected)).toBe(true);
    (0, test_1.expect)(entries.map((e) => e.caseId)).toEqual([1, 3]);
});
(0, test_1.test)("filterTestCases: --from/--to filters by range inclusive", () => {
    const cases = [makeCase(5, "A"), makeCase(10, "B"), makeCase(15, "C"), makeCase(20, "D")];
    const statuses = new Map(cases.map((c) => [c.id, "not_automated"]));
    const args = (0, discovery_batch_1.parseBatchArgs)(["--from", "10", "--to", "15"]);
    const entries = filterTestCases(cases, statuses, args);
    (0, test_1.expect)(entries).toHaveLength(2);
    (0, test_1.expect)(entries.map((e) => e.caseId)).toEqual([10, 15]);
});
(0, test_1.test)("filterTestCases: omits active cases by default", () => {
    const cases = [makeCase(1, "Active"), makeCase(2, "Not auto"), makeCase(3, "Not auto 2")];
    const statuses = new Map([
        [1, "active"], [2, "not_automated"], [3, "not_automated"]
    ]);
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    const entries = filterTestCases(cases, statuses, args);
    const selected = entries.filter((e) => e.selected);
    (0, test_1.expect)(selected).toHaveLength(2);
    (0, test_1.expect)(selected.map((e) => e.caseId)).toEqual([2, 3]);
    const skipped = entries.find((e) => e.caseId === 1);
    (0, test_1.expect)(skipped?.selected).toBe(false);
    (0, test_1.expect)(skipped?.skipReason).toBe("already_active");
    (0, test_1.expect)(skipped?.status).toBe("skipped_active");
});
(0, test_1.test)("filterTestCases: --include-active keeps active cases", () => {
    const cases = [makeCase(1, "Active"), makeCase(2, "Not auto")];
    const statuses = new Map([
        [1, "active"], [2, "not_automated"]
    ]);
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--include-active"]);
    const entries = filterTestCases(cases, statuses, args);
    const selected = entries.filter((e) => e.selected);
    (0, test_1.expect)(selected).toHaveLength(2);
    (0, test_1.expect)(selected.find((e) => e.caseId === 1)?.activeAtSelection).toBe(true);
});
(0, test_1.test)("filterTestCases: --not-automated keeps only not_automated", () => {
    const cases = [makeCase(1, "Active"), makeCase(2, "Not auto"), makeCase(3, "Draft")];
    const statuses = new Map([
        [1, "active"], [2, "not_automated"], [3, "draft"]
    ]);
    const args = (0, discovery_batch_1.parseBatchArgs)(["--not-automated"]);
    const entries = filterTestCases(cases, statuses, args);
    const selected = entries.filter((e) => e.selected);
    (0, test_1.expect)(selected).toHaveLength(1);
    (0, test_1.expect)(selected[0].caseId).toBe(2);
    const skippedNotAuto = entries.find((e) => e.caseId === 1);
    (0, test_1.expect)(skippedNotAuto?.skipReason).toBe("not_not_automated");
});
(0, test_1.test)("filterTestCases: --limit caps selected entries after filters", () => {
    const cases = [makeCase(1, "A"), makeCase(2, "B"), makeCase(3, "C"), makeCase(4, "D"), makeCase(5, "E")];
    const statuses = new Map(cases.map((c) => [c.id, "not_automated"]));
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--limit", "2"]);
    const entries = filterTestCases(cases, statuses, args);
    const selected = entries.filter((e) => e.selected);
    (0, test_1.expect)(selected).toHaveLength(2);
    (0, test_1.expect)(selected.map((e) => e.caseId)).toEqual([1, 2]);
    const limited = entries.filter((e) => e.skipReason === "limit_reached");
    (0, test_1.expect)(limited).toHaveLength(3);
});
(0, test_1.test)("filterTestCases: limit applies after include-active filter", () => {
    const cases = [makeCase(1, "Active"), makeCase(2, "Not auto"), makeCase(3, "Not auto 2")];
    const statuses = new Map([
        [1, "active"], [2, "not_automated"], [3, "not_automated"]
    ]);
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--include-active", "--limit", "2"]);
    const entries = filterTestCases(cases, statuses, args);
    const selected = entries.filter((e) => e.selected);
    (0, test_1.expect)(selected).toHaveLength(2);
    (0, test_1.expect)(selected.map((e) => e.caseId)).toEqual([1, 2]);
});
(0, test_1.test)("filterTestCases: empty result when no cases match", () => {
    const cases = [];
    const statuses = new Map();
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
    const entries = filterTestCases(cases, statuses, args);
    (0, test_1.expect)(entries).toHaveLength(0);
});
(0, test_1.test)("filterTestCases: --case-ids with no matches returns empty", () => {
    const cases = [makeCase(1, "A"), makeCase(2, "B")];
    const statuses = new Map([[1, "not_automated"], [2, "not_automated"]]);
    const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "99,100"]);
    const entries = filterTestCases(cases, statuses, args);
    (0, test_1.expect)(entries).toHaveLength(0);
});
(0, test_1.test)("filterTestCases: not_automated + includeActive combination works", () => {
    const cases = [makeCase(1, "Active"), makeCase(2, "Not auto")];
    const statuses = new Map([
        [1, "active"], [2, "not_automated"]
    ]);
    const args = (0, discovery_batch_1.parseBatchArgs)(["--not-automated", "--include-active"]);
    const entries = filterTestCases(cases, statuses, args);
    // --not-automated filters to only not_automated, so active is still excluded by mode
    const selected = entries.filter((e) => e.selected);
    (0, test_1.expect)(selected).toHaveLength(1);
    (0, test_1.expect)(selected[0].caseId).toBe(2);
});
(0, test_1.test)("filterTestCases: --overwrite does not imply rerun-active/include-active", () => {
    const cases = [makeCase(1, "Active"), makeCase(2, "Not auto")];
    const statuses = new Map([
        [1, "active"], [2, "not_automated"]
    ]);
    const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--overwrite"]);
    const entries = filterTestCases(cases, statuses, args);
    (0, test_1.expect)(entries.find((e) => e.caseId === 1)?.selected).toBe(false);
    (0, test_1.expect)(entries.find((e) => e.caseId === 1)?.skipReason).toBe("already_active");
});
// --- BatchResult summary calculation tests ---
(0, test_1.test)("BatchResult summary counts are correct", () => {
    const result = {
        batchId: "test-batch",
        timestamp: new Date().toISOString(),
        args: {
            mode: "all",
            caseIds: [],
            headed: false,
            autoPromote: false,
            promotionDryRun: false,
            promotionStrict: false,
            requirePromotionApproval: false,
            dryRun: false,
            includeActive: false,
            rerunActive: false,
            stopOnFail: false,
            concurrency: 1,
            parallel: false,
            autoRepair: false,
            repairTimeoutMs: 120000,
            showAgentLog: false,
            continueOnAgentTimeout: true
        },
        skippedCases: [{ caseId: 5, reason: "already_active" }],
        rerunActiveCases: [],
        cases: [
            { caseId: 1, title: "Selected", selected: true, status: "selected", promoted: false },
            { caseId: 2, title: "Passed", selected: true, status: "discovered_passed", promoted: false, durationMs: 100 },
            { caseId: 3, title: "Promoted", selected: true, status: "promoted", promoted: true, durationMs: 200 },
            { caseId: 4, title: "Failed", selected: true, status: "failed", promoted: false, failureReason: "error", durationMs: 50 },
            { caseId: 5, title: "Skipped Active", selected: false, status: "skipped_active", promoted: false },
            { caseId: 6, title: "Promo Failed", selected: true, status: "promotion_failed", promoted: false, durationMs: 300 },
            { caseId: 7, title: "Not Promoted", selected: true, status: "not_promoted", promoted: false, durationMs: 150 },
            { caseId: 8, title: "Expl Failed", selected: true, status: "exploration_failed", promoted: false, durationMs: 80 }
        ],
        summary: {
            requested: 8,
            selected: 8,
            executed: 7,
            skipped: 1,
            passed: 1,
            failed: 2,
            promoted: 1,
            alreadyActiveSkipped: 1,
            activeRerun: 0,
            promotionFailed: 1,
            notPromoted: 1,
            totalDurationMs: 880
        }
    };
    (0, test_1.expect)(result.summary.selected).toBe(8);
    (0, test_1.expect)(result.summary.requested).toBe(8);
    (0, test_1.expect)(result.summary.executed).toBe(7);
    (0, test_1.expect)(result.summary.skipped).toBe(1);
    (0, test_1.expect)(result.summary.passed).toBe(1);
    (0, test_1.expect)(result.summary.failed).toBe(2);
    (0, test_1.expect)(result.summary.promoted).toBe(1);
    (0, test_1.expect)(result.summary.alreadyActiveSkipped).toBe(1);
    (0, test_1.expect)(result.summary.activeRerun).toBe(0);
    (0, test_1.expect)(result.summary.promotionFailed).toBe(1);
    (0, test_1.expect)(result.summary.notPromoted).toBe(1);
});
(0, test_1.test)("Batch case entry carries root-cause forensics fields", () => {
    const entry = {
        caseId: 1001,
        title: "Checkout case",
        selected: true,
        status: "failed",
        promoted: false,
        failureReason: "pending_local_assertions",
        rootCauseCategory: "assertion_consumption_gap",
        topPendingAssertions: ["Country", "Confirmation closed"],
        pendingAssertionCount: 2,
        autoRepairCalled: false,
        autoRepairReason: "none",
        localClosureConsumedCount: 3,
        notConsumedReasons: ["normalization_mismatch", "missing_history"]
    };
    (0, test_1.expect)(entry.rootCauseCategory).toBe("assertion_consumption_gap");
    (0, test_1.expect)(entry.pendingAssertionCount).toBe(2);
    (0, test_1.expect)(entry.notConsumedReasons?.length).toBeGreaterThan(0);
});
(0, test_1.test)("resolveBatchAppProfile: CLI --app wins over APP_SLUG", async () => {
    const previous = process.env.APP_SLUG;
    process.env.APP_SLUG = "env-app";
    try {
        const args = (0, discovery_batch_1.parseBatchArgs)(["--all", "--app", "cli-app"]);
        const resolved = await (0, discovery_batch_1.resolveBatchAppProfile)(args);
        (0, test_1.expect)(resolved.appProfile.appSlug).toBe("cli-app");
        (0, test_1.expect)(resolved.appProfile.source).toBe("cli");
    }
    finally {
        if (previous === undefined) {
            delete process.env.APP_SLUG;
        }
        else {
            process.env.APP_SLUG = previous;
        }
    }
});
(0, test_1.test)("resolveBatchAppProfile: APP_SLUG wins when --app is not provided", async () => {
    const previous = process.env.APP_SLUG;
    process.env.APP_SLUG = "env-priority";
    try {
        const args = (0, discovery_batch_1.parseBatchArgs)(["--all"]);
        const resolved = await (0, discovery_batch_1.resolveBatchAppProfile)(args);
        (0, test_1.expect)(resolved.appProfile.appSlug).toBe("env-priority");
        (0, test_1.expect)(resolved.appProfile.source).toBe("env");
    }
    finally {
        if (previous === undefined) {
            delete process.env.APP_SLUG;
        }
        else {
            process.env.APP_SLUG = previous;
        }
    }
});
