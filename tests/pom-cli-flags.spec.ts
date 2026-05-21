import { test, expect } from "@playwright/test";
import { parseDiscoveryCaseArgs } from "../src/cli/discovery-case";
import { parseBatchArgs } from "../src/cli/discovery-batch";

test("discovery:case --page-object-mode is default (true)", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "100"]);
  expect(args.pageObjectMode).toBe(true);
});

test("discovery:case --no-page-object-mode sets false", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "100", "--no-page-object-mode"]);
  expect(args.pageObjectMode).toBe(false);
});

test("discovery:case --inline-debug-spec sets true", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "100", "--inline-debug-spec"]);
  expect(args.inlineDebugSpec).toBe(true);
});

test("discovery:case --allow-page-object-candidates is default (true)", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "100"]);
  expect(args.allowPageObjectCandidates).toBe(true);
});

test("discovery:case --no-page-object-candidates sets false", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "100", "--no-page-object-candidates"]);
  expect(args.allowPageObjectCandidates).toBe(false);
});

test("discovery:batch --page-object-mode is default (true)", () => {
  const args = parseBatchArgs(["--case-ids", "100"]);
  expect(args.pageObjectMode).toBe(true);
});

test("discovery:batch --no-page-object-mode sets false", () => {
  const args = parseBatchArgs(["--case-ids", "100", "--no-page-object-mode"]);
  expect(args.pageObjectMode).toBe(false);
});

test("discovery:batch --inline-debug-spec sets true", () => {
  const args = parseBatchArgs(["--case-ids", "100", "--inline-debug-spec"]);
  expect(args.inlineDebugSpec).toBe(true);
});

test("discovery:batch --allow-page-object-candidates is default (true)", () => {
  const args = parseBatchArgs(["--case-ids", "100"]);
  expect(args.allowPageObjectCandidates).toBe(true);
});

test("discovery:batch --no-page-object-candidates sets false", () => {
  const args = parseBatchArgs(["--case-ids", "100", "--no-page-object-candidates"]);
  expect(args.allowPageObjectCandidates).toBe(false);
});

test("discovery:case existing flags still work with POM flags", () => {
  const args = parseDiscoveryCaseArgs([
    "--case-id", "500",
    "--headed",
    "--auto-promote",
    "--promotion-dry-run",
    "--page-object-mode",
    "--inline-debug-spec"
  ]);
  expect(args.caseId).toBe(500);
  expect(args.headed).toBe(true);
  expect(args.autoPromote).toBe(true);
  expect(args.promotionDryRun).toBe(true);
  expect(args.pageObjectMode).toBe(true);
  expect(args.inlineDebugSpec).toBe(true);
});

test("discovery:batch existing flags still work with POM flags", () => {
  const args = parseBatchArgs([
    "--case-ids", "100,200",
    "--headed",
    "--auto-promote",
    "--auto-repair",
    "--no-page-object-mode"
  ]);
  expect(args.caseIds).toEqual([100, 200]);
  expect(args.headed).toBe(true);
  expect(args.autoPromote).toBe(true);
  expect(args.autoRepair).toBe(true);
  expect(args.pageObjectMode).toBe(false);
});
