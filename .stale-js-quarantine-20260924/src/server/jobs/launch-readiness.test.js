"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const launch_orchestrator_1 = require("./launch-orchestrator");
const runs_1 = require("../routes/runs");
(0, node_test_1.describe)("launch readiness authority", () => {
    (0, node_test_1.test)("keeps explicit false and route discovery adaptive", () => {
        strict_1.default.equal((0, launch_orchestrator_1.classifyLaunchScenarioAuthority)({ mcpExecutable: false, executionReadiness: "requires_route_discovery" }), "adaptive");
        strict_1.default.equal((0, launch_orchestrator_1.classifyLaunchScenarioAuthority)({ mcpExecutable: true, executionReadiness: "standard" }), "standard");
    });
    (0, node_test_1.test)("does not elevate missing authority or publication metadata", () => {
        strict_1.default.equal((0, launch_orchestrator_1.classifyLaunchScenarioAuthority)({ mcpExecutable: undefined, executionReadiness: undefined }), "adaptive");
        const [scenario] = (0, runs_1.extractLaunchScenariosFromPayload)({ selectedScenarios: [{ scenarioId: "A", title: "adaptive", steps: [], preconditions: [], expectedResult: "", mcpExecutable: false, executionReadiness: "requires_route_discovery", publicationClassification: "documentation", nonAutomatable: true }] });
        strict_1.default.equal(scenario.mcpExecutable, false);
        strict_1.default.equal(scenario.executionReadiness, "requires_route_discovery");
        strict_1.default.equal(scenario.publicationClassification, "documentation");
    });
    (0, node_test_1.test)("replay fixture remains 2 standard and 2 adaptive", () => {
        const fixture = [
            { mcpExecutable: true, executionReadiness: "standard" },
            { mcpExecutable: true, executionReadiness: "standard" },
            { mcpExecutable: false, executionReadiness: "requires_route_discovery" },
            { mcpExecutable: false, executionReadiness: "requires_route_discovery" },
        ];
        const classifications = fixture.map(launch_orchestrator_1.classifyLaunchScenarioAuthority);
        strict_1.default.equal(classifications.filter((value) => value === "standard").length, 2);
        strict_1.default.equal(classifications.filter((value) => value === "adaptive").length, 2);
    });
    (0, node_test_1.test)("separates route discovery from functional adaptive execution", () => {
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
        strict_1.default.deepEqual((0, launch_orchestrator_1.classifyRouteDiscoveryEligibility)(routePending), { allowed: true, reasonCode: "requires_route_discovery" });
        const groups = (0, launch_orchestrator_1.partitionLaunchScenarios)([
            { ...routePending, scenarioId: "S1", mcpExecutable: true, executionReadiness: "standard" },
            { ...routePending, scenarioId: "S2", mcpExecutable: true, executionReadiness: "standard" },
            routePending,
            { ...routePending, scenarioId: "S4", functionalBranch: undefined },
        ]);
        strict_1.default.equal(groups.standard.length, 2);
        strict_1.default.equal(groups.routeDiscovery.length, 1);
        strict_1.default.equal(groups.adaptiveFunctional.length, 1);
        strict_1.default.equal(groups.routeDiscovery[0].mcpExecutable, false);
        strict_1.default.equal(groups.standard.length + groups.routeDiscovery.length, 3);
    });
    (0, node_test_1.test)("rejects discovery without structured lineage or with non-automatable authority", () => {
        const base = { executionReadiness: "requires_route_discovery", semanticValidity: "valid" };
        strict_1.default.equal((0, launch_orchestrator_1.classifyRouteDiscoveryEligibility)(base).reasonCode, "missing_structured_lineage");
        strict_1.default.equal((0, launch_orchestrator_1.classifyRouteDiscoveryEligibility)({ ...base, functionalBranch: { branchId: "BR-1" }, nonAutomatable: true }).reasonCode, "non_automatable");
        strict_1.default.equal((0, launch_orchestrator_1.classifyRouteDiscoveryEligibility)({ ...base, functionalBranch: { branchId: "BR-1" }, validation: { valid: false } }).reasonCode, "semantic_scenario_invalid");
    });
    (0, node_test_1.test)("preserves direct and metadata lineage through backend normalization", () => {
        const [direct] = (0, runs_1.extractLaunchScenariosFromPayload)({ selectedScenarios: [{ scenarioId: "S3", title: "direct", steps: [], preconditions: [], expectedResult: "", mcpExecutable: false, executionReadiness: "requires_route_discovery", semanticValidity: "valid", branchId: "BR-1", stepRequirementRefs: [{ stepIndex: 0, requirementId: "REQ-1" }] }] });
        const [metadata] = (0, runs_1.extractLaunchScenariosFromPayload)({ selectedScenarios: [{ scenarioId: "S4", title: "metadata", steps: [], preconditions: [], expectedResult: "", metadata: { mcpExecutable: false, executionReadiness: "requires_route_discovery", semanticValidity: "valid", branchId: "BR-2", stepRequirementRefs: [{ stepIndex: 0, requirementId: "REQ-2" }] } }] });
        strict_1.default.equal(direct.mcpExecutable, false);
        strict_1.default.equal(direct.executionReadiness, "requires_route_discovery");
        strict_1.default.equal(direct.branchId, "BR-1");
        strict_1.default.equal(direct.stepRequirementRefs?.length, 1);
        strict_1.default.equal(metadata.branchId, "BR-2");
        strict_1.default.equal(metadata.stepRequirementRefs?.length, 1);
        strict_1.default.equal((0, launch_orchestrator_1.classifyRouteDiscoveryEligibility)(direct).allowed, true);
        strict_1.default.equal((0, launch_orchestrator_1.classifyRouteDiscoveryEligibility)(metadata).allowed, true);
    });
});
