import { test, expect } from "@playwright/test";
import {
  getJiraPreviewTestRailGuardError,
  JIRA_PREVIEW_TESTRAIL_UNSUPPORTED,
} from "../src/server/jira-preview-testrail-guard";

for (const flag of ["publishToTestRail", "createTestRun"]) {
  test(`jira_semantic rejects ${flag}=true`, () => {
    const err = getJiraPreviewTestRailGuardError("jira_semantic", { [flag]: true });
    expect(err?.error).toBe(JIRA_PREVIEW_TESTRAIL_UNSUPPORTED);
    expect(err?.message).toContain("/api/runs/launch-execution");
  });

  test(`recording_replay allows ${flag}=true`, () => {
    expect(getJiraPreviewTestRailGuardError("recording_replay", { [flag]: true })).toBeNull();
  });
}

test("jira_semantic allows flags false/absent", () => {
  expect(getJiraPreviewTestRailGuardError("jira_semantic", { publishToTestRail: false, createTestRun: false })).toBeNull();
  expect(getJiraPreviewTestRailGuardError("jira_semantic", {})).toBeNull();
});
