import { test, expect } from "@playwright/test";
import { parseBatchArgs } from "../src/cli/discovery-batch";

test("discovery-batch accepts context-only and forwards the opt-in value", () => {
  const contextOnlyArgs = parseBatchArgs([
    "--case-ids", "123",
    "--app", "fixture-app",
    "--context-only",
  ]);

  expect(contextOnlyArgs.contextOnly).toBe(true);
  expect(contextOnlyArgs.caseIds).toEqual([123]);
  expect(contextOnlyArgs.app).toBe("fixture-app");
});

test("discovery-batch keeps context-only disabled by default", () => {
  expect(parseBatchArgs(["--case-ids", "123"]).contextOnly).toBe(false);
});
