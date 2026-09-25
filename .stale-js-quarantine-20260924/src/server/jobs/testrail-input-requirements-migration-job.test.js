"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_input_requirements_migration_job_1 = require("./testrail-input-requirements-migration-job");
(0, vitest_1.describe)("TestRail input requirements migration job", () => {
    (0, vitest_1.it)("reports completed cases and keeps requirements isolated by caseId", async () => {
        const result = await (0, testrail_input_requirements_migration_job_1.runTestRailInputRequirementsMigrationJob)({
            projectSlug: "project-a",
            cases: [
                { id: 601, title: "First", custom_preconds: "Customer id (customer.id, text)" },
                { id: 602, title: "Second", custom_preconds: "Account id (account.id, text)" },
            ],
        });
        (0, vitest_1.expect)(result).toMatchObject({ totalCases: 2, completed: 2, empty: 0, blocked: 0 });
        (0, vitest_1.expect)(result.results).toEqual([
            { caseId: 601, status: "completed", requirementsCount: 1 },
            { caseId: 602, status: "completed", requirementsCount: 1 },
        ]);
    });
    (0, vitest_1.it)("reports an empty case without creating requirements", async () => {
        const result = await (0, testrail_input_requirements_migration_job_1.runTestRailInputRequirementsMigrationJob)({
            projectSlug: "project-a",
            cases: [{ id: 603, title: "Empty", custom_expected: "The operation succeeds" }],
        });
        (0, vitest_1.expect)(result).toEqual({
            totalCases: 1,
            completed: 0,
            empty: 1,
            blocked: 0,
            results: [{ caseId: 603, status: "empty", requirementsCount: 0 }],
        });
    });
    (0, vitest_1.it)("reports a blocked case when requirement metadata conflicts", async () => {
        const result = await (0, testrail_input_requirements_migration_job_1.runTestRailInputRequirementsMigrationJob)({
            projectSlug: "project-a",
            cases: [{
                    id: 604,
                    title: "Conflict",
                    custom_preconds: "User (auth.user, text)\nSecret user (auth.user, password)",
                }],
        });
        (0, vitest_1.expect)(result).toMatchObject({ totalCases: 1, completed: 0, empty: 0, blocked: 1 });
        (0, vitest_1.expect)(result.results[0]).toEqual({ caseId: 604, status: "blocked", requirementsCount: 0 });
    });
    (0, vitest_1.it)("continues processing after one case throws", async () => {
        const result = await (0, testrail_input_requirements_migration_job_1.runTestRailInputRequirementsMigrationJob)({
            projectSlug: "project-a",
            cases: [
                null,
                { id: 605, title: "Valid", custom_preconds: "Customer id (customer.id, text)" },
            ],
        });
        (0, vitest_1.expect)(result.totalCases).toBe(2);
        (0, vitest_1.expect)(result.results).toEqual([
            { caseId: 0, status: "blocked", requirementsCount: 0 },
            { caseId: 605, status: "completed", requirementsCount: 1 },
        ]);
        (0, vitest_1.expect)(result.completed).toBe(1);
        (0, vitest_1.expect)(result.blocked).toBe(1);
    });
});
