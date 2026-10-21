import assert from "node:assert/strict";
import test from "node:test";
import { projectReusedSpecLiveOutput, summarizeReusedSpecError } from "./reuse-spec-live-log";

test("reused-spec live projection retains only step boundary markers the panel can render", () => {
  assert.equal(projectReusedSpecLiveOutput({
    stream: "stdout",
    line: "[promoted-step] stepIndex=4 phase=start currentUrl=https://test.local runtimeModuleVersion=123",
  }), "[promoted-step] stepIndex=4 phase=start");
  assert.equal(projectReusedSpecLiveOutput({
    stream: "stderr",
    line: "[promoted-step] stepIndex=4 phase=failed failureClass=assertion_not_satisfied currentUrl=https://test.local",
  }), "[promoted-step] stepIndex=4 phase=failed failureClass=assertion_not_satisfied");
  assert.equal(projectReusedSpecLiveOutput({ stream: "stdout", line: "[promoted-step] stepIndex=4 phase=ensure_initial_evidence_start" }), undefined);
  assert.equal(projectReusedSpecLiveOutput({ stream: "stdout", line: "Playwright repeated diagnostic output" }), undefined);
});

test("reused-spec failure summary removes duplicated wrappers, preserves the failure, and stays bounded", () => {
  const summary = summarizeReusedSpecError([
    "Command failed: npx playwright test case.spec.ts",
    "[promote-plan] child stdout: duplicated report",
    "Error: locator.click: Timeout 5000ms exceeded.",
    "Error: locator.click: Timeout 5000ms exceeded.",
    `expect(locator).toBeVisible() failed ${"detail ".repeat(400)}`,
  ].join("\n"), 200);

  assert.ok(summary);
  assert.ok(summary.length <= 200);
  assert.match(summary, /Timeout 5000ms exceeded/);
  assert.doesNotMatch(summary, /Command failed:|duplicated report/);
});
