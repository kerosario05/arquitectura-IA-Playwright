"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const testrail_1 = require("../src/server/routes/testrail");
(0, test_1.test)("resolveSectionCases returns cases for a valid section", async () => {
    const tr = {
        getSection: async () => ({ id: 4903, name: "Sección A", project_id: 56, suite_id: 1731 }),
        getCases: async () => [{ id: 1, title: "Caso 1" }, { id: 2, title: "Caso 2" }],
    };
    const result = await (0, testrail_1.resolveSectionCases)(tr, { sectionId: 4903, projectId: 56, suiteId: 1731 });
    (0, test_1.expect)(result.status).toBe(200);
    (0, test_1.expect)(result.body).toMatchObject({
        ok: true,
        sectionId: 4903,
        projectId: 56,
        suiteId: 1731,
    });
    (0, test_1.expect)(result.body.cases).toHaveLength(2);
});
(0, test_1.test)("resolveSectionCases returns empty cases for a valid section without cases", async () => {
    const tr = {
        getSection: async () => ({ id: 4903, name: "Sección A", project_id: 56, suite_id: 1731 }),
        getCases: async () => [],
    };
    const result = await (0, testrail_1.resolveSectionCases)(tr, { sectionId: 4903, projectId: 56, suiteId: 1731 });
    (0, test_1.expect)(result.status).toBe(200);
    (0, test_1.expect)(result.body.cases).toEqual([]);
});
(0, test_1.test)("resolveSectionCases returns 404 when the section does not exist", async () => {
    const tr = {
        getSection: async () => null,
        getCases: async () => [],
    };
    const result = await (0, testrail_1.resolveSectionCases)(tr, { sectionId: 9999, projectId: 56, suiteId: 1731 });
    (0, test_1.expect)(result.status).toBe(404);
    (0, test_1.expect)(result.body).toMatchObject({
        ok: false,
        error: "section_not_found",
        sectionId: 9999,
    });
});
