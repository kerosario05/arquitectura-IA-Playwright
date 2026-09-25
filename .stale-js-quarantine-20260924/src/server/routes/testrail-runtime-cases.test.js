"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const testrail_1 = require("./testrail");
function rawCase(id, customPreconds) {
    return {
        id,
        title: `Case ${id}`,
        section_id: 7,
        suite_id: 8,
        custom_preconds: customPreconds,
        custom_steps: "Abrir la aplicación",
        custom_expected: "La aplicación responde",
        custom_marker: `raw-${id}`,
    };
}
function clientWith(cases) {
    return {
        getSection: async () => ({ id: 7, project_id: 1, suite_id: 8 }),
        getCases: async () => cases,
    };
}
(0, node_test_1.default)("marks a correctly transformed case without requirements as success", async () => {
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93001)]), { sectionId: 7 });
    const returned = response.body.cases[0];
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(returned.custom_marker, "raw-93001");
    strict_1.default.equal(returned.normalizedScenario.caseId, 93001);
    strict_1.default.equal(returned.normalizedScenario.source, "testrail");
    strict_1.default.equal(returned.runtimeTransformStatus, "success");
    strict_1.default.deepEqual(returned.inputRequirements, []);
});
(0, node_test_1.default)("marks a correctly transformed case with runtime requirements as success", async () => {
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93002, "Cuenta (account.id, text)")]), { sectionId: 7 });
    strict_1.default.equal(response.body.cases[0].runtimeTransformStatus, "success");
    strict_1.default.equal(response.body.cases[0].inputRequirements[0].key, "account.id");
    strict_1.default.equal(response.body.cases[0].inputRequirements[0].source, "contract");
});
(0, node_test_1.default)("materializes transformed requirements for the matching local TestRail project and case", async () => {
    const persisted = [];
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93006)]), { sectionId: 7, projectId: 30 }, () => ({
        normalizedScenario: { caseId: 93006 },
        inputRequirements: [
            { key: "auth.company", label: "Company", controlType: "text", required: true },
            { key: "auth.username", label: "Username", controlType: "text", required: true },
            { key: "auth.password", label: "Password", controlType: "password", required: true, sensitive: true },
        ],
        unresolvedPlaceholders: [],
        conflicts: [],
    }), {
        resolveLocalProject: async () => ({ id: "local-project", slug: "portal-project" }),
        materialize: async (input) => persisted.push(input),
    });
    strict_1.default.equal(response.body.cases[0].runtimeTransformStatus, "success");
    strict_1.default.equal(persisted.length, 1);
    strict_1.default.equal(persisted[0].localProjectSlug, "portal-project");
    strict_1.default.equal(persisted[0].caseId, 93006);
    strict_1.default.deepEqual(persisted[0].requirements.map((requirement) => requirement.key), [
        "auth.company",
        "auth.username",
        "auth.password",
    ]);
});
(0, node_test_1.default)("does not destructively materialize an empty derived requirement list", async () => {
    let materialized = 0;
    await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93010)]), { sectionId: 7, projectId: 30 }, () => ({
        normalizedScenario: { caseId: 93010 },
        inputRequirements: [],
        unresolvedPlaceholders: [],
        conflicts: [],
    }), {
        resolveLocalProject: async () => ({ id: "local-project", slug: "portal-project" }),
        materialize: async () => { materialized += 1; },
    });
    strict_1.default.equal(materialized, 0);
});
(0, node_test_1.default)("marks a failed transformation without exposing error details", async () => {
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93003)]), { sectionId: 7 }, () => { throw new Error("sensitive case content"); });
    const returned = response.body.cases[0];
    strict_1.default.equal(returned.custom_marker, "raw-93003");
    strict_1.default.equal(returned.runtimeTransformStatus, "error");
    strict_1.default.equal(returned.runtimeTransformErrorCode, "runtime_transform_failed");
    strict_1.default.equal(returned.normalizedScenario, null);
    strict_1.default.deepEqual(returned.inputRequirements, []);
    strict_1.default.deepEqual(returned.unresolvedPlaceholders, []);
    strict_1.default.deepEqual(returned.conflicts, []);
    strict_1.default.equal(JSON.stringify(returned).includes("sensitive case content"), false);
});
(0, node_test_1.default)("does not materialize a case when runtime transformation fails", async () => {
    let materialized = 0;
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93007)]), { sectionId: 7, projectId: 30 }, () => { throw new Error("runtime transform failed"); }, {
        resolveLocalProject: async () => ({ id: "local-project", slug: "portal-project" }),
        materialize: async () => { materialized += 1; },
    });
    strict_1.default.equal(response.body.cases[0].runtimeTransformStatus, "error");
    strict_1.default.equal(materialized, 0);
});
(0, node_test_1.default)("keeps the batch when one runtime transformation fails", async () => {
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93004), rawCase(93005)]), { sectionId: 7 }, (currentCase) => {
        if (currentCase.id === 93004)
            throw new Error("runtime transform failed");
        return {
            normalizedScenario: { caseId: currentCase.id },
            inputRequirements: [],
            unresolvedPlaceholders: [],
            conflicts: [],
        };
    });
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(response.body.cases.length, 2);
    strict_1.default.equal(response.body.cases[0].id, 93004);
    strict_1.default.equal(response.body.cases[0].runtimeTransformStatus, "error");
    strict_1.default.deepEqual(response.body.cases[0].inputRequirements, []);
    strict_1.default.equal(response.body.cases[1].id, 93005);
    strict_1.default.equal(response.body.cases[1].runtimeTransformStatus, "success");
    strict_1.default.equal(response.body.cases[1].normalizedScenario.caseId, 93005);
});
(0, node_test_1.default)("uses a valid localProjectId directly without reverse lookup", async () => {
    let directLookups = 0;
    let reverseLookups = 0;
    const persisted = [];
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93008)]), { sectionId: 7, projectId: 30, localProjectId: "local-project-1" }, () => ({
        normalizedScenario: { caseId: 93008 },
        inputRequirements: [{ key: "account.id", required: true }],
        unresolvedPlaceholders: [],
        conflicts: [],
    }), {
        resolveLocalProjectById: async () => {
            directLookups += 1;
            return { id: "local-project-1", slug: "portal-project" };
        },
        resolveLocalProject: async () => {
            reverseLookups += 1;
            return { id: "legacy-project", slug: "legacy-project" };
        },
        materialize: async (input) => persisted.push(input),
    });
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(directLookups, 1);
    strict_1.default.equal(reverseLookups, 0);
    strict_1.default.equal(persisted[0].localProjectId, "local-project-1");
});
(0, node_test_1.default)("rejects an unknown localProjectId without legacy fallback", async () => {
    let reverseLookups = 0;
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93009)]), { sectionId: 7, projectId: 30, localProjectId: "missing-project" }, undefined, {
        resolveLocalProjectById: async () => null,
        resolveLocalProject: async () => {
            reverseLookups += 1;
            return { id: "legacy-project", slug: "legacy-project" };
        },
    });
    strict_1.default.equal(response.status, 404);
    strict_1.default.equal(response.body.error, "local_project_not_found");
    strict_1.default.equal(reverseLookups, 0);
});
(0, node_test_1.default)("keeps reverse lookup when localProjectId is absent", async () => {
    let reverseLookups = 0;
    const response = await (0, testrail_1.resolveSectionCases)(clientWith([rawCase(93010)]), { sectionId: 7, projectId: 30 }, undefined, {
        resolveLocalProject: async () => {
            reverseLookups += 1;
            return { id: "legacy-project", slug: "legacy-project" };
        },
        materialize: async () => undefined,
    });
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(reverseLookups, 1);
});
