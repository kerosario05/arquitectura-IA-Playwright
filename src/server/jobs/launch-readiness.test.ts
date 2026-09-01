import { describe, expect, test } from "node:test";
import assert from "node:assert/strict";
import { classifyLaunchScenarioAuthority, classifyRouteDiscoveryEligibility, partitionLaunchScenarios } from "./launch-orchestrator";
import { extractLaunchScenariosFromPayload } from "../routes/runs";

describe("launch readiness authority", () => {
  test("keeps explicit false and route discovery adaptive", () => {
    assert.equal(classifyLaunchScenarioAuthority({ mcpExecutable: false, executionReadiness: "requires_route_discovery" }), "adaptive");
    assert.equal(classifyLaunchScenarioAuthority({ mcpExecutable: true, executionReadiness: "standard" }), "standard");
  });

  test("does not elevate missing authority or publication metadata", () => {
    assert.equal(classifyLaunchScenarioAuthority({ mcpExecutable: undefined, executionReadiness: undefined }), "adaptive");
    const [scenario] = extractLaunchScenariosFromPayload({ selectedScenarios: [{ scenarioId: "A", title: "adaptive", steps: [], preconditions: [], expectedResult: "", mcpExecutable: false, executionReadiness: "requires_route_discovery", publicationClassification: "documentation", nonAutomatable: true }] });
    assert.equal(scenario.mcpExecutable, false);
    assert.equal(scenario.executionReadiness, "requires_route_discovery");
    assert.equal(scenario.publicationClassification, "documentation");
  });

  test("replay fixture remains 2 standard and 2 adaptive", () => {
    const fixture = [
      { mcpExecutable: true, executionReadiness: "standard" },
      { mcpExecutable: true, executionReadiness: "standard" },
      { mcpExecutable: false, executionReadiness: "requires_route_discovery" },
      { mcpExecutable: false, executionReadiness: "requires_route_discovery" },
    ];
    const classifications = fixture.map(classifyLaunchScenarioAuthority);
    assert.equal(classifications.filter((value) => value === "standard").length, 2);
    assert.equal(classifications.filter((value) => value === "adaptive").length, 2);
  });

  test("separates route discovery from functional adaptive execution", () => {
    const routePending = {
      scenarioId: "S3",
      title: "route pending",
      steps: ["click entry"],
      expectedResult: "screen",
      preconditions: [],
      mcpExecutable: false,
      executionReadiness: "requires_route_discovery",
      semanticValidity: "valid",
      functionalBranch: { branchId: "BR-1" },
    };
    assert.deepEqual(classifyRouteDiscoveryEligibility(routePending), { allowed: true, reasonCode: "requires_route_discovery" });
    const groups = partitionLaunchScenarios([
      { ...routePending, scenarioId: "S1", mcpExecutable: true, executionReadiness: "standard" },
      { ...routePending, scenarioId: "S2", mcpExecutable: true, executionReadiness: "standard" },
      routePending,
      { ...routePending, scenarioId: "S4", functionalBranch: undefined },
    ]);
    assert.equal(groups.standard.length, 2);
    assert.equal(groups.routeDiscovery.length, 1);
    assert.equal(groups.adaptiveFunctional.length, 1);
    assert.equal(groups.routeDiscovery[0].mcpExecutable, false);
    assert.equal(groups.standard.length + groups.routeDiscovery.length, 3);
  });

  test("rejects discovery without structured lineage or with non-automatable authority", () => {
    const base = { executionReadiness: "requires_route_discovery", semanticValidity: "valid" } as const;
    assert.equal(classifyRouteDiscoveryEligibility(base).reasonCode, "missing_structured_lineage");
    assert.equal(classifyRouteDiscoveryEligibility({ ...base, functionalBranch: { branchId: "BR-1" }, nonAutomatable: true }).reasonCode, "non_automatable");
    assert.equal(classifyRouteDiscoveryEligibility({ ...base, functionalBranch: { branchId: "BR-1" }, validation: { valid: false } }).reasonCode, "semantic_scenario_invalid");
  });

  test("preserves direct and metadata lineage through backend normalization", () => {
    const [direct] = extractLaunchScenariosFromPayload({ selectedScenarios: [{ scenarioId: "S3", title: "direct", steps: [], preconditions: [], expectedResult: "", mcpExecutable: false, executionReadiness: "requires_route_discovery", semanticValidity: "valid", branchId: "BR-1", stepRequirementRefs: [{ stepIndex: 0, requirementId: "REQ-1" }] }] });
    const [metadata] = extractLaunchScenariosFromPayload({ selectedScenarios: [{ scenarioId: "S4", title: "metadata", steps: [], preconditions: [], expectedResult: "", metadata: { mcpExecutable: false, executionReadiness: "requires_route_discovery", semanticValidity: "valid", branchId: "BR-2", stepRequirementRefs: [{ stepIndex: 0, requirementId: "REQ-2" }] } }] });
    assert.equal(direct.mcpExecutable, false);
    assert.equal(direct.executionReadiness, "requires_route_discovery");
    assert.equal(direct.branchId, "BR-1");
    assert.equal(direct.stepRequirementRefs?.length, 1);
    assert.equal(metadata.branchId, "BR-2");
    assert.equal(metadata.stepRequirementRefs?.length, 1);
    assert.equal(classifyRouteDiscoveryEligibility(direct).allowed, true);
    assert.equal(classifyRouteDiscoveryEligibility(metadata).allowed, true);
  });
});
