"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const canonical_scenario_1 = require("./canonical-scenario");
const shared = {
    title: "Complete account recovery",
    preconditions: ["The account exists"],
    steps: [{
            order: 1,
            action: "Start account recovery",
            expected: "Recovery form is displayed",
            requirementRefs: ["req-recovery"],
            origin: { originRef: "step-1", sourcePath: "steps[0]" },
        }],
    expectedResults: ["The account recovery flow is available"],
    requirements: [{
            requirementId: "req-recovery",
            kind: "action",
            description: "The user can start account recovery",
            origin: { originRef: "requirement-1" },
            coverability: "coverable",
        }],
    branches: [{
            branchId: "branch-main",
            requirementRefs: ["req-recovery"],
            conditions: ["The account exists"],
            destinationIntent: "Recovery form",
        }],
};
function scenario(sourceRef, originRef) {
    return {
        canonicalSchemaVersion: canonical_scenario_1.CANONICAL_SCENARIO_SCHEMA_VERSION,
        scenarioId: "scenario-recovery",
        ...shared,
        sourceRef,
        provenance: {
            sourceRef,
            adapterOrGenerator: originRef,
            canonicalizationMode: "deterministic_normalized",
            originRefs: [originRef],
            canonicalSchemaVersion: canonical_scenario_1.CANONICAL_SCENARIO_SCHEMA_VERSION,
        },
    };
}
(0, node_test_1.default)("TestRail and Jira use the same functional CanonicalScenario shape", () => {
    const testrail = scenario({ kind: "testrail", caseId: 101, sectionId: 7, suiteId: 3, projectId: 5 }, "testrail-adapter");
    const jira = scenario({ kind: "jira", issueKey: "QA-101", sprintId: 8, projectKey: "QA" }, "jira-generator");
    strict_1.default.deepEqual({ ...testrail, sourceRef: undefined, provenance: undefined }, { ...jira, sourceRef: undefined, provenance: undefined });
    strict_1.default.equal(testrail.sourceRef.kind, "testrail");
    strict_1.default.equal(jira.sourceRef.kind, "jira");
    strict_1.default.equal(testrail.provenance.sourceRef, testrail.sourceRef);
    strict_1.default.equal(jira.provenance.sourceRef, jira.sourceRef);
});
(0, node_test_1.default)("execution and local input bindings are outside the canonical functional contract", () => {
    const canonical = scenario({ kind: "testrail", caseId: 102 }, "testrail-adapter");
    const forbidden = canonical;
    strict_1.default.equal("source" in forbidden, false);
    strict_1.default.equal("sourceId" in forbidden, false);
    strict_1.default.equal("inputRequirements" in forbidden, false);
    strict_1.default.equal("executionReadiness" in forbidden, false);
    strict_1.default.equal("requirementAccounting" in forbidden, false);
    strict_1.default.equal("mcpExecutable" in forbidden, false);
    strict_1.default.equal("namedProfileRef" in canonical.requirements[0], false);
    strict_1.default.equal("routeAuthority" in canonical.branches[0], false);
    strict_1.default.equal(canonical_scenario_1.CANONICAL_SCENARIO_SCHEMA_VERSION, "canonical-scenario-1");
});
