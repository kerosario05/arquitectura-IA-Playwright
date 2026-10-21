import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(__dirname, "runs.ts"), "utf8");

test("legacy Jira-origin scenario reruns dispatch through the dedicated Jira engine before Recording reuse", () => {
  const inference = source.indexOf("inferLegacyJiraRerunOrigin(issueKey, prepared.scenarios)");
  const jiraCreate = source.indexOf('executionEngine: "jira_semantic"', inference);
  const jiraDispatch = source.indexOf("setImmediate(() => startScenarioPreviewRun(jiraJob.id))", inference);
  const jiraReturn = source.indexOf("return;", jiraDispatch);
  const recordingReuse = source.indexOf("if (prepared.allReusable)", inference);
  assert.ok(inference !== -1 && jiraCreate > inference && jiraDispatch > jiraCreate && jiraReturn > jiraDispatch);
  assert.ok(recordingReuse > jiraReturn, "the Jira rerun must return before Recording promoted-spec reuse classification");
  const block = source.slice(inference, jiraReturn);
  assert.ok(block.includes("scenarioOrigin: jiraOrigin"));
  assert.ok(block.includes("autoPromote: true"));
  assert.ok(block.includes("autoPom: false"));
  assert.ok(block.includes("publishToTestRail: false"));
});

test("Jira reruns project an allowlist of semantic fields and do not copy Recording execution contracts", () => {
  const start = source.indexOf("const jiraScenarios = prepared.scenarios.map");
  const end = source.indexOf("const jiraJob = jobStore.create", start);
  assert.ok(start !== -1 && end > start);
  const projection = source.slice(start, end);
  for (const field of ["scenarioId", "title", "sourceIssueKey", "steps", "expectedResult", "preconditions", "authIntent"]) {
    assert.ok(projection.includes(`${field}:`), `Jira semantic rerun retains ${field}`);
  }
  assert.ok(projection.includes("inputRequirements:"), "reruns retain the fields needed for required-input preflight");
  assert.ok(!projection.includes("recordingExecutionContract"));
  assert.ok(!projection.includes("canonicalInteractions"));
});

test("Jira scenario previews reject missing required runtime inputs before creating a job", () => {
  const routeStart = source.indexOf('runsRouter.post("/scenario-preview"');
  const jobCreate = source.indexOf('jobStore.create("scenario-preview", jobPayload', routeStart);
  const preflight = source.indexOf("findMissingJiraInputsForExecution(", routeStart);
  assert.ok(routeStart >= 0 && preflight > routeStart && jobCreate > preflight);
  assert.ok(source.slice(preflight, jobCreate).includes('error: "JIRA_REQUIRED_DATA_MISSING"'));
});

test("Jira launch validates scenario inputs before invoking TestRail publication", () => {
  const routeStart = source.indexOf('runsRouter.post("/launch-execution"');
  const launchInvocation = source.indexOf("launchExecution(launchInput)", routeStart);
  const preflight = source.indexOf("findMissingJiraInputsForExecution(appSlug, jiraScenarios, dataOverrides)", routeStart);
  const rejection = source.indexOf('error: "JIRA_REQUIRED_DATA_MISSING"', preflight);
  assert.ok(routeStart >= 0 && preflight > routeStart && rejection > preflight && launchInvocation > rejection);
  const routeBlock = source.slice(routeStart, launchInvocation);
  assert.ok(routeBlock.includes("inputRequirements: rawById.get(scenario.scenarioId)?.inputRequirements"));
  assert.ok(routeBlock.includes("return;"), "missing data must exit before launchExecution can publish to TestRail");
});

test("Existing TestRail cases linked to Jira are validated before launchExecution creates a Run", () => {
  const routeStart = source.indexOf('runsRouter.post("/launch-execution"');
  const lineage = source.indexOf("buildExistingJiraCaseScenarios(appSlug, existingTestRailCaseIds)", routeStart);
  const rejection = source.indexOf('error: "JIRA_REQUIRED_DATA_MISSING"', lineage);
  const launchInvocation = source.indexOf("launchExecution(launchInput)", routeStart);
  assert.ok(lineage > routeStart && rejection > lineage && launchInvocation > rejection);
  assert.ok(source.slice(rejection, launchInvocation).includes("return;"));
});

test("Jira reruns retain prior runtime values when no replacements are supplied and preflight before job creation", () => {
  const branchStart = source.indexOf('if (previous?.params.executionEngine === "jira_semantic")');
  const branchEnd = source.indexOf("// 2. Prepare rerun from canonical artifacts", branchStart);
  const block = source.slice(branchStart, branchEnd);
  assert.ok(block.includes("req.body?.dataOverrides ?? previous.params.dataOverrides"));
  assert.ok(block.indexOf("findMissingJiraInputsForExecution(") < block.indexOf('jobStore.create("scenario-preview"'));
  assert.ok(block.includes('error: "JIRA_REQUIRED_DATA_MISSING"'));
});
