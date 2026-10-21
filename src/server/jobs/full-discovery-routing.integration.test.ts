import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDiscoveryBatchParamsFromLaunch,
  resolveExistingCaseExecutionPlan,
  type LaunchExecutionInput,
} from "./launch-orchestrator";
import { jobStore } from "./job-store";
import {
  resolveRediscoveryIntent,
  resolveRouteFromValidation,
} from "./discovery-batch-runner";

function launchInput(overrides: Partial<LaunchExecutionInput> = {}): LaunchExecutionInput {
  return {
    appSlug: "app-a",
    sectionSlug: "section-a",
    sectionName: "Section A",
    projectId: 11,
    suiteId: 22,
    sectionId: 33,
    selectedScenarios: [],
    existingTestRailCaseIds: [100],
    runtimeEntriesByCase: {
      "100": [{ key: "auth.username", value: "runtime-fixture", source: "runtime_context", sensitive: false }],
    },
    ...overrides,
  };
}

function routeAfterRunnerReceivesJob(params: Record<string, unknown>, discoveryRequired = false) {
  const job = jobStore.create("discovery-batch", params);
  const stored = jobStore.getInternal(job.id);
  assert.ok(stored);
  const runnerParams = stored.params as Record<string, unknown>;
  const intent = resolveRediscoveryIntent({
    forceRediscovery: runnerParams.forceRediscovery as boolean | undefined,
    overwrite: runnerParams.overwrite as boolean | undefined,
    rerunActive: runnerParams.rerunActive as boolean | undefined,
    executePromotedSpecs: runnerParams.executePromotedSpecs as boolean | undefined,
  });
  const route = resolveRouteFromValidation({
    caseId: 100,
    appSlug: String(runnerParams.appSlug),
    forceRediscovery: intent.explicit,
    discoveryRequired,
    rediscoveryIntent: intent.rediscoveryIntent,
    validation: {
      reusable: !discoveryRequired,
      blocked: false,
      reason: discoveryRequired ? "missing_test_data" : "promoted_spec_valid",
      specPath: "automations/apps/app-a/sections/section-a/cases/c100/case.spec.ts",
    },
    ...(discoveryRequired ? {
      contractEvaluation: { sufficient: false, reasonCode: "missing_test_data", recommendedRoute: "blocked" } as any,
    } : {}),
  });
  return { runnerParams, intent, route };
}

const publishedCases = [{ scenarioId: "TR-CASE-100", caseId: 100, title: "Case A" }];

test("productive launch handoff preserves explicit Full Discovery through job, runner, intent and route", () => {
  const params = buildDiscoveryBatchParamsFromLaunch({
    launch: launchInput({ forceRediscovery: true }),
    executionCaseIds: [100],
    publishedCases,
    launchId: "launch-integration-a",
    testRunId: 44,
  });
  const { runnerParams, intent, route } = routeAfterRunnerReceivesJob(params);

  assert.equal(runnerParams.forceRediscovery, true);
  assert.equal(runnerParams.runtimeEntriesByCase !== undefined, true);
  assert.equal(intent.explicit, true);
  assert.equal(intent.source, "user_request");
  assert.equal(route.route, "full_discovery");
  assert.equal(route.reason, "explicit_rediscovery_requested");
});

test("automatic missing-spec handoff chooses Full Discovery despite contract review gaps", () => {
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [100],
    appSlug: "app-a",
    entries: [],
    caseContracts: new Map([[100, { usable: false, reasonCode: "missing_test_data", recommendedRoute: "blocked" as const }]]),
  });
  const params = buildDiscoveryBatchParamsFromLaunch({
    launch: launchInput(),
    executionCaseIds: [100],
    publishedCases: [{ ...publishedCases[0], executionSource: "mcp_required" }],
    launchId: "launch-integration-missing-spec",
  });
  const { route } = routeAfterRunnerReceivesJob(params, plan.mcpRequired[0]?.executionSource === "mcp_required");

  assert.equal(plan.launchAccepted, true);
  assert.equal(plan.mcpRequired[0]?.executionSource, "mcp_required");
  assert.equal(route.route, "full_discovery");
  assert.equal(route.reason, "promoted_spec_missing_or_unusable");
});

test("productive launch handoff preserves false and keeps legacy flags out of rediscovery", () => {
  const params = buildDiscoveryBatchParamsFromLaunch({
    launch: launchInput({ forceRediscovery: false }),
    executionCaseIds: [100],
    publishedCases,
    launchId: "launch-integration-b",
  });
  const { runnerParams, intent, route } = routeAfterRunnerReceivesJob(params);

  assert.equal(runnerParams.forceRediscovery, false);
  assert.equal(intent.explicit, false);
  assert.equal(intent.rerunIntent, false);
  assert.equal(route.route, "promoted_reuse");
});

test("productive launch handoff keeps an absent forceRediscovery property absent", () => {
  const params = buildDiscoveryBatchParamsFromLaunch({
    launch: launchInput(),
    executionCaseIds: [100],
    publishedCases,
    launchId: "launch-integration-c",
  });
  const { runnerParams, intent, route } = routeAfterRunnerReceivesJob(params);

  assert.equal(Object.prototype.hasOwnProperty.call(runnerParams, "forceRediscovery"), false);
  assert.equal(intent.explicit, false);
  assert.equal(route.route, "promoted_reuse");
});

test("productive launch handoff preserves explicit overwrite for generated artifacts", () => {
  const params = buildDiscoveryBatchParamsFromLaunch({
    launch: launchInput({ forceRediscovery: false, overwrite: true }),
    executionCaseIds: [100],
    publishedCases,
    launchId: "launch-integration-overwrite",
  });

  assert.equal(params.overwrite, true);
  assert.equal(params.forceRediscovery, false);
});

test("Jira dataOverrides reach the child job params intact, keyed by scenarioId", () => {
  const dataOverrides = { "SC-1": { "step-2:field": "v1" }, "SC-2": { "step-1:field": "v2" } };
  const build = (launch: LaunchExecutionInput) =>
    buildDiscoveryBatchParamsFromLaunch({ launch, executionCaseIds: [100], publishedCases, launchId: "launch-jira-overrides" });

  assert.deepEqual(build(launchInput({ dataOverrides })).dataOverrides, dataOverrides);
  assert.equal(Object.prototype.hasOwnProperty.call(build(launchInput()), "dataOverrides"), false);
});
