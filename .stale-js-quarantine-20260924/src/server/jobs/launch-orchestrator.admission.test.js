"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const launch_orchestrator_1 = require("./launch-orchestrator");
(0, node_test_1.default)("new automatable case is admitted for discovery when no promoted spec exists", () => {
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [90001],
        appSlug: "synthetic-app",
        sectionSlug: "synthetic-section",
        entries: [],
        caseContracts: new Map([[90001, {
                    usable: false,
                    reasonCode: "targeted_gap_resolution_required",
                    recommendedRoute: "targeted_discovery",
                }]]),
    });
    strict_1.default.deepEqual(plan.existingSpec, []);
    strict_1.default.equal(plan.mcpRequired.length, 1);
    strict_1.default.deepEqual(plan.blocked, []);
    strict_1.default.equal(plan.admitted.length, 1);
    strict_1.default.equal(plan.admitted[0].mcpRequired, true);
    strict_1.default.equal(plan.launchAccepted, true);
});
(0, node_test_1.default)("existing valid promoted spec remains reusable", () => {
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [90002],
        appSlug: "synthetic-app",
        sectionSlug: "synthetic-section",
        entries: [{
                id: "synthetic-automation",
                caseId: 90002,
                appSlug: "synthetic-app",
                status: "active",
                pomStatus: "promoted",
                specVerificationStatus: "passed",
            }],
        validateSpec: () => ({ reusable: true, reason: "promoted_spec_valid", specPath: "synthetic.spec.ts" }),
    });
    strict_1.default.equal(plan.existingSpec.length, 1);
    strict_1.default.deepEqual(plan.mcpRequired, []);
    strict_1.default.deepEqual(plan.blocked, []);
    strict_1.default.equal(plan.launchAccepted, true);
});
