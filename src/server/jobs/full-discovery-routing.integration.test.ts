import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDiscoveryBatchParamsFromLaunch,
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
      "100": [{ key: "auth.username", value: "runtime-fixture", source: "test", sensitive: false }],
    },
    ...overrides,
  };
}

function routeAfterRunnerReceivesJob(params: Record<string, unknown>) {
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
    rediscoveryIntent: intent.rediscoveryIntent,
    validation: {
      reusable: true,
      blocked: false,
      reason: "promoted_spec_valid",
      specPath: "automations/apps/app-a/sections/section-a/cases/c100/case.spec.ts",
    },
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
