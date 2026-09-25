"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const testrail_input_requirements_sync_1 = require("./testrail-input-requirements-sync");
function dependencies(parsed) {
    const calls = { adapted: [], resolved: [], persisted: [] };
    return {
        calls,
        adapter: (rawCase) => {
            calls.adapted.push(rawCase);
            return parsed;
        },
        resolveProjectId: async (projectSlug) => {
            calls.resolved.push(projectSlug);
            return "project-id-from-resolver";
        },
        replaceForProjectAndCase: async (projectId, caseId, requirements) => {
            calls.persisted.push({ projectId, caseId, requirements });
        },
    };
}
(0, node_test_1.test)("syncs parsed requirements from contractual TestRail fields", async () => {
    const requirements = [{ key: "account.id", label: "Account id", controlType: "text", required: true, sensitive: false, allowedValues: [] }];
    const deps = dependencies({ requirements, unresolvedPlaceholders: [], conflicts: [] });
    const result = await (0, testrail_input_requirements_sync_1.syncTestRailInputRequirements)({
        projectSlug: "project-a",
        caseId: 42,
        rawTestRailCase: {
            id: 42,
            title: "Fixture",
            custom_preconds: "Account id (account.id, text)",
            custom_steps: "Use [account.id]",
            custom_expected: "Expected result",
        },
    }, deps);
    strict_1.default.equal(result.persisted, true);
    strict_1.default.equal(deps.calls.adapted[0].id, 42);
    strict_1.default.deepEqual(deps.calls.persisted, [{ projectId: "project-id-from-resolver", caseId: 42, requirements }]);
});
(0, node_test_1.test)("does not resolve or persist when TestRail has no requirements", async () => {
    const deps = dependencies({ requirements: [], unresolvedPlaceholders: [], conflicts: [] });
    const result = await (0, testrail_input_requirements_sync_1.syncTestRailInputRequirements)({ projectSlug: "project-b", caseId: 43, rawTestRailCase: { id: 43, title: "Fixture" } }, deps);
    strict_1.default.equal(result.persisted, false);
    strict_1.default.deepEqual(deps.calls.resolved, []);
    strict_1.default.deepEqual(deps.calls.persisted, []);
});
(0, node_test_1.test)("passes parser-deduplicated requirements without creating duplicates", async () => {
    const requirements = [{ key: "account.value", label: "Value", controlType: "text", required: true, sensitive: false, allowedValues: [] }];
    const deps = dependencies({ requirements, unresolvedPlaceholders: [], conflicts: [] });
    await (0, testrail_input_requirements_sync_1.syncTestRailInputRequirements)({
        projectSlug: "project-c",
        caseId: 44,
        rawTestRailCase: { id: 44, title: "Fixture", custom_preconds: "Value (account.value, text)\nValue (account.value, text)" },
    }, deps);
    strict_1.default.deepEqual(deps.calls.persisted[0].requirements, requirements);
});
(0, node_test_1.test)("preserves the adapter conflict result instead of silently persisting it", async () => {
    const deps = dependencies({
        requirements: [{ key: "account.value" }],
        unresolvedPlaceholders: [],
        conflicts: [{ key: "account.value" }],
    });
    await strict_1.default.rejects((0, testrail_input_requirements_sync_1.syncTestRailInputRequirements)({
        projectSlug: "project-d",
        caseId: 45,
        rawTestRailCase: { id: 45, title: "Fixture" },
    }, deps), /conflicting input requirement metadata.*account\.value/);
    strict_1.default.deepEqual(deps.calls.persisted, []);
});
(0, node_test_1.test)("keeps persistence isolated when caseId changes", async () => {
    const requirements = [{ key: "account.value" }];
    const deps = dependencies({ requirements, unresolvedPlaceholders: [], conflicts: [] });
    await (0, testrail_input_requirements_sync_1.syncTestRailInputRequirements)({ projectSlug: "project-e", caseId: 46, rawTestRailCase: { id: 46, title: "First" } }, deps);
    await (0, testrail_input_requirements_sync_1.syncTestRailInputRequirements)({ projectSlug: "project-e", caseId: 47, rawTestRailCase: { id: 47, title: "Second" } }, deps);
    strict_1.default.deepEqual(deps.calls.persisted.map((call) => call.caseId), [46, 47]);
});
