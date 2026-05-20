import { test, expect } from "@playwright/test";
import { mapExecutionStatusToTestRail, formatDuration, buildComment } from "../src/testrail/testrail-reporter";
import type { PlanExecutionResult } from "../src/types/plan-execution.types";

test("mapExecutionStatusToTestRail maps passed to 1", () => {
  expect(mapExecutionStatusToTestRail("passed")).toBe(1);
});

test("mapExecutionStatusToTestRail maps failed to 5", () => {
  expect(mapExecutionStatusToTestRail("failed")).toBe(5);
});

test("mapExecutionStatusToTestRail maps partial to 5 (failed)", () => {
  expect(mapExecutionStatusToTestRail("partial")).toBe(5);
});

test("mapExecutionStatusToTestRail maps skipped to 2 (blocked)", () => {
  expect(mapExecutionStatusToTestRail("skipped")).toBe(2);
});

test("formatDuration formats seconds correctly", () => {
  expect(formatDuration(5000)).toBe("5s");
});

test("formatDuration formats minutes and seconds correctly", () => {
  expect(formatDuration(125000)).toBe("2m 5s");
});

test("buildComment includes failed steps info", () => {
  const result: PlanExecutionResult = {
    scenario: { source: "testrail", externalId: "C123", caseId: 123, title: "Test" },
    status: "failed",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:05.000Z",
    durationMs: 5000,
    evidenceDir: "/tmp/evidence",
    steps: [
      { index: 1, action: "navigate", status: "passed", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:02.000Z", durationMs: 2000 },
      { index: 2, action: "click", status: "failed", startedAt: "2026-01-01T00:00:02.000Z", finishedAt: "2026-01-01T00:00:05.000Z", durationMs: 3000, error: "Element not found" }
    ]
  };
  const comment = buildComment(result);
  expect(comment).toContain("Failed steps:");
  expect(comment).toContain("#2 (click)");
  expect(comment).toContain("Element not found");
  expect(comment).toContain("/tmp/evidence");
});

test("buildComment includes evidence dir for passed results", () => {
  const result: PlanExecutionResult = {
    scenario: { source: "testrail", externalId: "C123", caseId: 123, title: "Test" },
    status: "passed",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:05.000Z",
    durationMs: 5000,
    evidenceDir: "/tmp/evidence",
    steps: [
      { index: 1, action: "navigate", status: "passed", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:05.000Z", durationMs: 5000 }
    ]
  };
  const comment = buildComment(result);
  expect(comment).toContain("/tmp/evidence");
  expect(comment).not.toContain("Failed steps:");
});