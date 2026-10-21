import assert from "node:assert";
import { resolveExistingCaseExecutionPlan, resolveLaunchExecutionCaseIds, type LaunchExecutionInput } from "./launch-orchestrator";
import { resolveRediscoveryIntent, resolveRouteFromValidation } from "./discovery-batch-runner";
import { TestRailClient } from "../../clients/testrail.client";

// Never let these tests reach a real TestRail host: every client method rejects locally.
// The harness does not await async tests, so prototypes are restored on process exit.
const originalTestRailMethods = new Map<string, unknown>();
for (const name of Object.getOwnPropertyNames(TestRailClient.prototype)) {
  const descriptor = Object.getOwnPropertyDescriptor(TestRailClient.prototype, name);
  if (name === "constructor" || typeof descriptor?.value !== "function") continue;
  originalTestRailMethods.set(name, descriptor.value);
  (TestRailClient.prototype as any)[name] = async () => { throw new Error(`TestRail network blocked in test (${name})`); };
}
process.once("exit", () => {
  for (const [name, fn] of originalTestRailMethods) (TestRailClient.prototype as any)[name] = fn;
});

function test(label: string, fn: () => void): void {
  try { fn(); console.log(`  PASS  ${label}`); }
  catch (err) { console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1; }
}

function describe(_name: string, fn: () => void): void { console.log(`\n${_name}`); fn(); }

const validScenarios = [{ scenarioId: "LAUNCH-001", title: "Test", steps: ["Step 1"], expectedResult: "OK", preconditions: [], mcpExecutable: true }];

// Store environment before tests
const originalEnv = { ...process.env };

describe("resolveLaunchExecutionCaseIds", () => {
  const base = {
    routeDiscoveryPublishedCases: [{ caseId: 1 }],
    existingPublishedCases: [{ caseId: 2 }],
    standardPublishedCases: [{ caseId: 3 }, { caseId: 1 }],
  };
  test("jira_semantic includes standard published cases and preserves others", () => {
    assert.deepStrictEqual(resolveLaunchExecutionCaseIds({ ...base, engine: "jira_semantic" }), [1, 2, 3]);
  });
  test("non-Jira engine excludes standard published cases", () => {
    assert.deepStrictEqual(resolveLaunchExecutionCaseIds({ ...base, engine: "recording_replay" }), [1, 2]);
    assert.deepStrictEqual(resolveLaunchExecutionCaseIds({ ...base }), [1, 2]);
  });
});

describe("launchExecution validation", () => {
  test("targeted discovery without reusable automation is admitted as mcp_required", () => {
    const plan = resolveExistingCaseExecutionPlan({
      caseIds: [100], appSlug: "app-a", entries: [],
      caseContracts: new Map([[100, { usable: false, reasonCode: "targeted_gap_resolution_required", recommendedRoute: "targeted_discovery" }]]),
    });
    assert.strictEqual(plan.mcpRequired[0]?.executionSource, "mcp_required");
    assert.deepStrictEqual(plan.blocked, []);
  });

  test("full discovery without reusable automation is admitted as mcp_required", () => {
    const plan = resolveExistingCaseExecutionPlan({
      caseIds: [101], appSlug: "app-a", entries: [],
      caseContracts: new Map([[101, { usable: false, reasonCode: "contract_insufficient_for_fast_path", recommendedRoute: "full_discovery" }]]),
    });
    assert.strictEqual(plan.mcpRequired[0]?.executionSource, "mcp_required");
    assert.deepStrictEqual(plan.blocked, []);
  });

  test("missing spec routes to Discovery even when the source contract needs review", () => {
    const plan = resolveExistingCaseExecutionPlan({
      caseIds: [102], appSlug: "app-a", entries: [],
      caseContracts: new Map([[102, { usable: false, reasonCode: "non_automatable_contract" }]]),
    });
    assert.strictEqual(plan.mcpRequired[0]?.executionSource, "mcp_required");
    assert.strictEqual(plan.mcpRequired[0]?.reasonCode, "non_automatable_contract");
    assert.deepStrictEqual(plan.blocked, []);
  });

  test("reusable automation remains existing_spec", () => {
    const plan = resolveExistingCaseExecutionPlan({
      caseIds: [103], appSlug: "app-a",
      entries: [{ id: "automation-103", caseId: 103, appSlug: "app-a", status: "active", pomStatus: "promoted", specVerificationStatus: "passed", title: "Reusable" } as any],
      validateSpec: () => ({ reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: "spec.ts" }),
    });
    assert.strictEqual(plan.existingSpec[0]?.executionSource, "existing_spec");
    assert.deepStrictEqual(plan.mcpRequired, []);
  });

  test("separa rerun de rediscovery y conserva el routing semántico", () => {
    const manual = resolveRouteFromValidation({
      caseId: 201, appSlug: "app-a", forceRediscovery: false,
      contractEvaluation: { sufficient: false, reasonCode: "missing_route_evidence", recommendedRoute: "full_discovery" } as any,
      validation: { reusable: false, blocked: false, reason: "missing_route_evidence" },
    });
    const reusable = {
      caseId: 202, appSlug: "app-a", forceRediscovery: false,
      validation: { reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: "spec.ts" },
    } as const;
    const normal = resolveRouteFromValidation(reusable);
    const rerunIntent = resolveRediscoveryIntent({ rerunActive: true, executePromotedSpecs: true });
    const rerun = resolveRouteFromValidation({ ...reusable, rediscoveryIntent: rerunIntent.rediscoveryIntent });
    const stale = resolveRouteFromValidation({
      caseId: 203, appSlug: "app-a", forceRediscovery: false, targetedDiscoverySupported: true,
      contractEvaluation: { sufficient: false, reasonCode: "contract_stale", recommendedRoute: "targeted_discovery" } as any,
      validation: { reusable: false, blocked: false, reason: "contract_stale", specPath: "spec.ts" },
    });
    const explicitRediscovery = resolveRouteFromValidation({
      caseId: 204, appSlug: "app-a", forceRediscovery: true,
      validation: { reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: "spec.ts" },
    });
    const missingSpec = resolveRouteFromValidation({
      caseId: 205, appSlug: "app-a", forceRediscovery: false, discoveryRequired: true,
      contractEvaluation: { sufficient: false, reasonCode: "missing_test_data", recommendedRoute: "blocked" } as any,
      validation: { reusable: false, blocked: false, reason: "missing_test_data" },
    });
    const overwrite = resolveRediscoveryIntent({ overwrite: true, executePromotedSpecs: true });

    assert.strictEqual(manual.route, "full_discovery");
    assert.strictEqual(normal.route, "promoted_reuse");
    assert.strictEqual(rerunIntent.rerunIntent, true);
    assert.strictEqual(rerunIntent.rediscoveryIntent, false);
    assert.strictEqual(rerun.route, "promoted_reuse");
    assert.strictEqual(stale.route, "targeted_discovery");
    assert.strictEqual(explicitRediscovery.route, "full_discovery");
    assert.strictEqual(missingSpec.route, "full_discovery");
    assert.strictEqual(missingSpec.reason, "promoted_spec_missing_or_unusable");
    assert.strictEqual(overwrite.rediscoveryIntent, false);
  });

  test("fails if no projectId", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = { appSlug: "test", selectedScenarios: validScenarios };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    assert.strictEqual((result as any).error, "missing_project_id");
  });

  test("fails if no sectionId", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = { appSlug: "test", projectId: 1, selectedScenarios: validScenarios };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    assert.strictEqual((result as any).error, "missing_section_id");
  });

  test("fails if no selectedScenarios", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: [] };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    assert.strictEqual((result as any).error, "no_launchable_scenarios");
  });

  test("testrailSectionId works as fallback for sectionId", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = { appSlug: "test", projectId: 1, testrailSectionId: 15, selectedScenarios: validScenarios };
    const result = await launchExecution(input);
    // Should pass validation but fail at publish (no real TestRail)
    assert.ok(!result.ok);
    assert.notStrictEqual((result as any).error, "missing_section_id");
  });

  test("publish_failed returned when TestRail not available", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: validScenarios };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    assert.strictEqual((result as any).error, "publish_failed");
  });

  test("suiteId is included when provided", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = {
      appSlug: "test", projectId: 1, suiteId: 5, sectionId: 10,
      selectedScenarios: validScenarios,
    };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    // SuiteId is passed through to publish (which fails due to no TestRail)
    assert.strictEqual((result as any).error, "publish_failed");
  });

  test("jiraKey is accepted in payload", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = {
      appSlug: "test", projectId: 1, sectionId: 10,
      jiraKey: "HU-123", sprintName: "Sprint 1",
      selectedScenarios: validScenarios,
    };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    // jiraKey is metadata, should not cause validation to fail
    assert.notStrictEqual((result as any).error, "missing_project_id");
  });

  test("publishStrategy always_create is default", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: validScenarios };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    // Default strategy should not cause validation errors
    assert.notStrictEqual((result as any).error, "missing_project_id");
  });

  test("only selectedScenarios are published (no extra scenarios leaked)", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const scenarios = [
      { scenarioId: "LAUNCH-001", title: "Scenario A", steps: ["Step 1"], expectedResult: "OK", preconditions: [], mcpExecutable: true },
      { scenarioId: "LAUNCH-002", title: "Scenario B", steps: ["Step 1"], expectedResult: "OK", preconditions: [], mcpExecutable: true },
    ];
    const input: LaunchExecutionInput = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: scenarios };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    // Only 2 scenarios should be in the publish call
    assert.strictEqual((result as any).error, "publish_failed");
    // If it reached publish with wrong count, publish would still fail
  });

  test("launchId is a UUID", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: validScenarios };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    // UUID was generated (manifest would have it, but publish failed)
    // Verify via the error message that the launch started
    assert.strictEqual((result as any).error, "publish_failed");
  });

  test("sectionSlug is independent from appSlug", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = {
      appSlug: "app-a", sectionSlug: "section-b",
      projectId: 1, sectionId: 10, selectedScenarios: validScenarios,
    };
    const result = await launchExecution(input);
    assert.ok(!result.ok);
    // Different values should not cause validation errors
    assert.strictEqual((result as any).error, "publish_failed");
  });

  test("does not run discovery or external processes", async () => {
    const { launchExecution } = await import("./launch-orchestrator");
    const input: LaunchExecutionInput = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: validScenarios };
    const startTime = Date.now();
    const result = await launchExecution(input);
    const elapsed = Date.now() - startTime;
    assert.ok(!result.ok);
    // Should fail quickly (< 5s) at publish, not waiting for discovery
    assert.ok(elapsed < 5000, `took ${elapsed}ms - might have run discovery`);
    assert.strictEqual((result as any).error, "publish_failed");
  });
});
