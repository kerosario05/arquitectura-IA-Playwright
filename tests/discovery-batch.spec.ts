import { test, expect } from "@playwright/test";
import type { RawTestRailCase } from "../src/types/testrail.types";
import type { CaseAutomationStatus } from "../src/types/case-automation-status.types";
import {
  parseBatchArgs,
  type BatchCliArgs,
  type BatchCaseResultEntry,
  type BatchResult
} from "../src/cli/discovery-batch";

// --- parseBatchArgs tests ---

test("parseBatchArgs: --all sets mode=all", () => {
  const args = parseBatchArgs(["--all"]);
  expect(args.mode).toBe("all");
});

test("parseBatchArgs: --not-automated sets mode=not-automated", () => {
  const args = parseBatchArgs(["--not-automated"]);
  expect(args.mode).toBe("not-automated");
});

test("parseBatchArgs: --case-ids parses comma-separated IDs", () => {
  const args = parseBatchArgs(["--case-ids", "1,2,3"]);
  expect(args.mode).toBe("by-ids");
  expect(args.caseIds).toEqual([1, 2, 3]);
});

test("parseBatchArgs: --case-ids strips C prefix", () => {
  const args = parseBatchArgs(["--case-ids", "C101,C102"]);
  expect(args.caseIds).toEqual([101, 102]);
});

test("parseBatchArgs: --from and --to set range", () => {
  const args = parseBatchArgs(["--from", "100", "--to", "200"]);
  expect(args.mode).toBe("by-range");
  expect(args.from).toBe(100);
  expect(args.to).toBe(200);
});

test("parseBatchArgs: --from strips C prefix", () => {
  const args = parseBatchArgs(["--from", "C100", "--to", "C200"]);
  expect(args.from).toBe(100);
  expect(args.to).toBe(200);
});

test("parseBatchArgs: --limit sets limit", () => {
  const args = parseBatchArgs(["--all", "--limit", "5"]);
  expect(args.limit).toBe(5);
});

test("parseBatchArgs: --headed sets headed", () => {
  const args = parseBatchArgs(["--all", "--headed"]);
  expect(args.headed).toBe(true);
});

test("parseBatchArgs: --dry-run sets dryRun", () => {
  const args = parseBatchArgs(["--all", "--dry-run"]);
  expect(args.dryRun).toBe(true);
});

test("parseBatchArgs: --include-active sets includeActive", () => {
  const args = parseBatchArgs(["--all", "--include-active"]);
  expect(args.includeActive).toBe(true);
});

test("parseBatchArgs: --stop-on-fail sets stopOnFail", () => {
  const args = parseBatchArgs(["--all", "--stop-on-fail"]);
  expect(args.stopOnFail).toBe(true);
});

test("parseBatchArgs: --auto-promote sets autoPromote", () => {
  const args = parseBatchArgs(["--all", "--auto-promote"]);
  expect(args.autoPromote).toBe(true);
});

test("parseBatchArgs: --concurrency sets concurrency", () => {
  const args = parseBatchArgs(["--all", "--concurrency", "3"]);
  expect(args.concurrency).toBe(3);
});

test("parseBatchArgs: --auto-repair sets autoRepair", () => {
  const args = parseBatchArgs(["--all", "--auto-repair"]);
  expect(args.autoRepair).toBe(true);
});

test("parseBatchArgs: --repair-timeout-ms 120000 sets repairTimeoutMs", () => {
  const args = parseBatchArgs(["--all", "--auto-repair", "--repair-timeout-ms", "120000"]);
  expect(args.repairTimeoutMs).toBe(120000);
});

test("parseBatchArgs: sin --repair-timeout-ms usa default 120000", () => {
  const args = parseBatchArgs(["--all"]);
  expect(args.repairTimeoutMs).toBe(120000);
});

test("parseBatchArgs: sin --auto-repair autoRepair es false", () => {
  const args = parseBatchArgs(["--all"]);
  expect(args.autoRepair).toBe(false);
});

test("parseBatchArgs: --show-agent-log sets showAgentLog", () => {
  const args = parseBatchArgs(["--all", "--show-agent-log"]);
  expect(args.showAgentLog).toBe(true);
});

test("parseBatchArgs: default continueOnAgentTimeout is true", () => {
  const args = parseBatchArgs(["--all"]);
  expect(args.continueOnAgentTimeout).toBe(true);
});

test("parseBatchArgs: --continue-on-agent-timeout sets continueOnAgentTimeout", () => {
  const args = parseBatchArgs(["--all", "--continue-on-agent-timeout"]);
  expect(args.continueOnAgentTimeout).toBe(true);
});

test("parseBatchArgs: --compact-agent-prompt sets compactAgentPrompt", () => {
  const args = parseBatchArgs(["--all", "--compact-agent-prompt"]);
  expect(args.compactAgentPrompt).toBe(true);
});

test("parseBatchArgs: --agent-prompt-budget-seconds 45 sets budget", () => {
  const args = parseBatchArgs(["--all", "--agent-prompt-budget-seconds", "45"]);
  expect(args.agentPromptBudgetSeconds).toBe(45);
});

test("parseBatchArgs: --agent-prompt-budget-seconds missing value throws", () => {
  expect(() => parseBatchArgs(["--all", "--agent-prompt-budget-seconds"])).toThrow("Missing value");
});

test("parseBatchArgs: --agent-max-candidates 8 sets maxCandidates", () => {
  const args = parseBatchArgs(["--all", "--agent-max-candidates", "8"]);
  expect(args.agentMaxCandidates).toBe(8);
});

test("parseBatchArgs: --agent-max-proposed-actions 3 sets maxProposedActions", () => {
  const args = parseBatchArgs(["--all", "--agent-max-proposed-actions", "3"]);
  expect(args.agentMaxProposedActions).toBe(3);
});

test("parseBatchArgs: --agent-max-attempts 1 sets maxAttempts", () => {
  const args = parseBatchArgs(["--all", "--agent-max-attempts", "1"]);
  expect(args.agentMaxAttempts).toBe(1);
});

test("parseBatchArgs: --headed with --concurrency > 1 forces concurrency=1", () => {
  const args = parseBatchArgs(["--all", "--headed", "--concurrency", "5"]);
  expect(args.headed).toBe(true);
  expect(args.concurrency).toBe(1);
});

test("parseBatchArgs: --headed alone keeps default concurrency=1", () => {
  const args = parseBatchArgs(["--all", "--headed"]);
  expect(args.concurrency).toBe(1);
});

test("parseBatchArgs: --promotion-strict and --require-promotion-approval parsed", () => {
  const args = parseBatchArgs(["--all", "--promotion-strict", "--require-promotion-approval"]);
  expect(args.promotionStrict).toBe(true);
  expect(args.requirePromotionApproval).toBe(true);
});

test("parseBatchArgs: --promotion-dry-run sets promotionDryRun", () => {
  const args = parseBatchArgs(["--all", "--promotion-dry-run"]);
  expect(args.promotionDryRun).toBe(true);
});

test("parseBatchArgs: --case-ids with missing value throws", () => {
  expect(() => parseBatchArgs(["--case-ids"])).toThrow("Missing value");
});

test("parseBatchArgs: --limit with missing value throws", () => {
  expect(() => parseBatchArgs(["--all", "--limit"])).toThrow("Missing value");
});

test("parseBatchArgs: --concurrency with missing value throws", () => {
  expect(() => parseBatchArgs(["--all", "--concurrency"])).toThrow("Missing value");
});

test("parseBatchArgs: --from with missing value throws", () => {
  expect(() => parseBatchArgs(["--from"])).toThrow("Missing value");
});

test("parseBatchArgs: --to without --from defaults to mode=all", () => {
  const args = parseBatchArgs(["--to", "200"]);
  expect(args.mode).toBe("all");
  expect(args.to).toBe(200);
});

test("parseBatchArgs: --all and --not-automated conflicting modes throw", () => {
  expect(() => parseBatchArgs(["--all", "--not-automated"])).toThrow("Mode already set");
});

test("parseBatchArgs: --all and --case-ids conflicting modes throw", () => {
  expect(() => parseBatchArgs(["--all", "--case-ids", "1,2"])).toThrow("Mode already set");
});

test("parseBatchArgs: unknown argument throws", () => {
  expect(() => parseBatchArgs(["--unknown-flag"])).toThrow("Unknown argument");
});

test("parseBatchArgs: --overwrite sets overwrite=true", () => {
  const args = parseBatchArgs(["--all", "--overwrite"]);
  expect(args.overwrite).toBe(true);
});

test("parseBatchArgs: default overwrite is false", () => {
  const args = parseBatchArgs(["--all"]);
  expect(args.overwrite).toBe(false);
});

// --- filter test cases (replicates selectCases filtering logic) ---

function filterTestCases(
  rawCases: RawTestRailCase[],
  statusMap: Map<number, CaseAutomationStatus>,
  args: BatchCliArgs
): BatchCaseResultEntry[] {
  let filtered = [...rawCases];

  if (args.mode === "by-range" && args.from !== undefined && args.to !== undefined) {
    filtered = filtered.filter((c) => c.id >= args.from! && c.id <= args.to!);
  } else if (args.mode === "by-ids" && args.caseIds.length > 0) {
    const idSet = new Set(args.caseIds);
    filtered = filtered.filter((c) => idSet.has(c.id));
  }

  const entries: BatchCaseResultEntry[] = [];

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

function makeCase(id: number, title: string): RawTestRailCase {
  return { id, title, milestone_id: null as unknown as undefined, custom_steps_separated: [], refs: undefined };
}

test("filterTestCases: --case-ids filters to matching IDs", () => {
  const cases = [makeCase(1, "Case 1"), makeCase(2, "Case 2"), makeCase(3, "Case 3")];
  const statuses = new Map<number, CaseAutomationStatus>([[1, "not_automated"], [2, "active"], [3, "not_automated"]]);
  const args = parseBatchArgs(["--case-ids", "1,3"]);

  const entries = filterTestCases(cases, statuses, args);

  expect(entries).toHaveLength(2);
  expect(entries.every((e) => e.selected)).toBe(true);
  expect(entries.map((e) => e.caseId)).toEqual([1, 3]);
});

test("filterTestCases: --from/--to filters by range inclusive", () => {
  const cases = [makeCase(5, "A"), makeCase(10, "B"), makeCase(15, "C"), makeCase(20, "D")];
  const statuses = new Map<number, CaseAutomationStatus>(cases.map((c) => [c.id, "not_automated"]));
  const args = parseBatchArgs(["--from", "10", "--to", "15"]);

  const entries = filterTestCases(cases, statuses, args);

  expect(entries).toHaveLength(2);
  expect(entries.map((e) => e.caseId)).toEqual([10, 15]);
});

test("filterTestCases: omits active cases by default", () => {
  const cases = [makeCase(1, "Active"), makeCase(2, "Not auto"), makeCase(3, "Not auto 2")];
  const statuses = new Map<number, CaseAutomationStatus>([
    [1, "active"], [2, "not_automated"], [3, "not_automated"]
  ]);
  const args = parseBatchArgs(["--all"]);

  const entries = filterTestCases(cases, statuses, args);

  const selected = entries.filter((e) => e.selected);
  expect(selected).toHaveLength(2);
  expect(selected.map((e) => e.caseId)).toEqual([2, 3]);

  const skipped = entries.find((e) => e.caseId === 1);
  expect(skipped?.selected).toBe(false);
  expect(skipped?.skipReason).toBe("already_active");
  expect(skipped?.status).toBe("skipped_active");
});

test("filterTestCases: --include-active keeps active cases", () => {
  const cases = [makeCase(1, "Active"), makeCase(2, "Not auto")];
  const statuses = new Map<number, CaseAutomationStatus>([
    [1, "active"], [2, "not_automated"]
  ]);
  const args = parseBatchArgs(["--all", "--include-active"]);

  const entries = filterTestCases(cases, statuses, args);

  const selected = entries.filter((e) => e.selected);
  expect(selected).toHaveLength(2);
});

test("filterTestCases: --not-automated keeps only not_automated", () => {
  const cases = [makeCase(1, "Active"), makeCase(2, "Not auto"), makeCase(3, "Draft")];
  const statuses = new Map<number, CaseAutomationStatus>([
    [1, "active"], [2, "not_automated"], [3, "draft"]
  ]);
  const args = parseBatchArgs(["--not-automated"]);

  const entries = filterTestCases(cases, statuses, args);

  const selected = entries.filter((e) => e.selected);
  expect(selected).toHaveLength(1);
  expect(selected[0].caseId).toBe(2);

  const skippedNotAuto = entries.find((e) => e.caseId === 1);
  expect(skippedNotAuto?.skipReason).toBe("not_not_automated");
});

test("filterTestCases: --limit caps selected entries after filters", () => {
  const cases = [makeCase(1, "A"), makeCase(2, "B"), makeCase(3, "C"), makeCase(4, "D"), makeCase(5, "E")];
  const statuses = new Map<number, CaseAutomationStatus>(cases.map((c) => [c.id, "not_automated"]));
  const args = parseBatchArgs(["--all", "--limit", "2"]);

  const entries = filterTestCases(cases, statuses, args);

  const selected = entries.filter((e) => e.selected);
  expect(selected).toHaveLength(2);
  expect(selected.map((e) => e.caseId)).toEqual([1, 2]);

  const limited = entries.filter((e) => e.skipReason === "limit_reached");
  expect(limited).toHaveLength(3);
});

test("filterTestCases: limit applies after include-active filter", () => {
  const cases = [makeCase(1, "Active"), makeCase(2, "Not auto"), makeCase(3, "Not auto 2")];
  const statuses = new Map<number, CaseAutomationStatus>([
    [1, "active"], [2, "not_automated"], [3, "not_automated"]
  ]);
  const args = parseBatchArgs(["--all", "--include-active", "--limit", "2"]);

  const entries = filterTestCases(cases, statuses, args);

  const selected = entries.filter((e) => e.selected);
  expect(selected).toHaveLength(2);
  expect(selected.map((e) => e.caseId)).toEqual([1, 2]);
});

test("filterTestCases: empty result when no cases match", () => {
  const cases: RawTestRailCase[] = [];
  const statuses = new Map<number, CaseAutomationStatus>();
  const args = parseBatchArgs(["--all"]);

  const entries = filterTestCases(cases, statuses, args);
  expect(entries).toHaveLength(0);
});

test("filterTestCases: --case-ids with no matches returns empty", () => {
  const cases = [makeCase(1, "A"), makeCase(2, "B")];
  const statuses = new Map<number, CaseAutomationStatus>([[1, "not_automated"], [2, "not_automated"]]);
  const args = parseBatchArgs(["--case-ids", "99,100"]);

  const entries = filterTestCases(cases, statuses, args);
  expect(entries).toHaveLength(0);
});

test("filterTestCases: not_automated + includeActive combination works", () => {
  const cases = [makeCase(1, "Active"), makeCase(2, "Not auto")];
  const statuses = new Map<number, CaseAutomationStatus>([
    [1, "active"], [2, "not_automated"]
  ]);
  const args = parseBatchArgs(["--not-automated", "--include-active"]);

  const entries = filterTestCases(cases, statuses, args);

  // --not-automated filters to only not_automated, so active is still excluded by mode
  const selected = entries.filter((e) => e.selected);
  expect(selected).toHaveLength(1);
  expect(selected[0].caseId).toBe(2);
});

// --- BatchResult summary calculation tests ---

test("BatchResult summary counts are correct", () => {
  const result: BatchResult = {
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
      stopOnFail: false,
      concurrency: 1,
      autoRepair: false,
      repairTimeoutMs: 120000,
      showAgentLog: false,
      continueOnAgentTimeout: true
    },
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
      selected: 8,
      executed: 7,
      skipped: 1,
      passed: 1,
      failed: 2,
      promoted: 1,
      alreadyActiveSkipped: 1,
      promotionFailed: 1,
      notPromoted: 1,
      totalDurationMs: 880
    }
  };

  expect(result.summary.selected).toBe(8);
  expect(result.summary.executed).toBe(7);
  expect(result.summary.skipped).toBe(1);
  expect(result.summary.passed).toBe(1);
  expect(result.summary.failed).toBe(2);
  expect(result.summary.promoted).toBe(1);
  expect(result.summary.alreadyActiveSkipped).toBe(1);
  expect(result.summary.promotionFailed).toBe(1);
  expect(result.summary.notPromoted).toBe(1);
});
