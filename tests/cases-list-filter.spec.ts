import { test, expect } from "@playwright/test";
import type { CaseAutomationStatus } from "../src/types/case-automation-status.types";

type NormalizedStatus = "all" | "automated" | "not_automated";

function normalizeStatusFilter(value: string | undefined): NormalizedStatus {
  if (!value || value === "all") return "all";
  if (value === "automated") return "automated";
  if (value === "not-automated" || value === "not_automated") return "not_automated";
  throw new Error("Invalid status. Expected one of: all, automated, not-automated, not_automated");
}

function matchesStatusFilter(status: CaseAutomationStatus, filter: NormalizedStatus): boolean {
  if (filter === "all") return true;
  if (filter === "automated") return status !== "not_automated" && status !== "different_profile";
  return status === filter;
}

test("normalizeStatusFilter: undefined returns all", () => {
  expect(normalizeStatusFilter(undefined)).toBe("all");
});

test("normalizeStatusFilter: empty string returns all", () => {
  expect(normalizeStatusFilter("")).toBe("all");
});

test("normalizeStatusFilter: 'all' returns all", () => {
  expect(normalizeStatusFilter("all")).toBe("all");
});

test("normalizeStatusFilter: 'automated' returns automated", () => {
  expect(normalizeStatusFilter("automated")).toBe("automated");
});

test("normalizeStatusFilter: 'not-automated' returns not_automated", () => {
  expect(normalizeStatusFilter("not-automated")).toBe("not_automated");
});

test("normalizeStatusFilter: 'not_automated' returns not_automated", () => {
  expect(normalizeStatusFilter("not_automated")).toBe("not_automated");
});

test("normalizeStatusFilter: invalid value throws clear error", () => {
  expect(() => normalizeStatusFilter("invalid")).toThrow(
    "Invalid status. Expected one of: all, automated, not-automated, not_automated"
  );
});

test("normalizeStatusFilter: 'pending' throws clear error", () => {
  expect(() => normalizeStatusFilter("pending")).toThrow(
    "Invalid status. Expected one of: all, automated, not-automated, not_automated"
  );
});

test("matchesStatusFilter: all matches not_automated", () => {
  expect(matchesStatusFilter("not_automated", "all")).toBe(true);
});

test("matchesStatusFilter: all matches active", () => {
  expect(matchesStatusFilter("active", "all")).toBe(true);
});

test("matchesStatusFilter: all matches draft", () => {
  expect(matchesStatusFilter("draft", "all")).toBe(true);
});

test("matchesStatusFilter: automated matches active", () => {
  expect(matchesStatusFilter("active", "automated")).toBe(true);
});

test("matchesStatusFilter: automated matches draft", () => {
  expect(matchesStatusFilter("draft", "automated")).toBe(true);
});

test("matchesStatusFilter: automated matches disabled", () => {
  expect(matchesStatusFilter("disabled", "automated")).toBe(true);
});

test("matchesStatusFilter: automated does NOT match not_automated", () => {
  expect(matchesStatusFilter("not_automated", "automated")).toBe(false);
});

test("matchesStatusFilter: not_automated matches only not_automated", () => {
  expect(matchesStatusFilter("not_automated", "not_automated")).toBe(true);
  expect(matchesStatusFilter("active", "not_automated")).toBe(false);
  expect(matchesStatusFilter("draft", "not_automated")).toBe(false);
  expect(matchesStatusFilter("disabled", "not_automated")).toBe(false);
  expect(matchesStatusFilter("different_profile", "not_automated")).toBe(false);
});

test("matchesStatusFilter: automated does NOT match different_profile", () => {
  expect(matchesStatusFilter("different_profile", "automated")).toBe(false);
});

test("matchesStatusFilter: different_profile matches all", () => {
  expect(matchesStatusFilter("different_profile", "all")).toBe(true);
});
