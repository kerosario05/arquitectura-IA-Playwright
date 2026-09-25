"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTestRailInputRequirementsMigrationJob = runTestRailInputRequirementsMigrationJob;
const testrail_requirement_migration_1 = require("../../testrail/testrail-requirement-migration");
async function runTestRailInputRequirementsMigrationJob(input) {
    const results = [];
    for (const rawCase of input.cases) {
        const caseId = Number(rawCase?.id) || 0;
        try {
            const migration = (0, testrail_requirement_migration_1.migrateTestRailRequirements)({
                caseId,
                rawCase,
                approvedProposals: [],
            });
            results.push({
                caseId,
                status: migration.status,
                requirementsCount: migration.requirements.length,
            });
        }
        catch {
            results.push({ caseId, status: "blocked", requirementsCount: 0 });
        }
    }
    return {
        totalCases: results.length,
        completed: results.filter((result) => result.status === "completed").length,
        empty: results.filter((result) => result.status === "empty").length,
        blocked: results.filter((result) => result.status === "blocked").length,
        results,
    };
}
