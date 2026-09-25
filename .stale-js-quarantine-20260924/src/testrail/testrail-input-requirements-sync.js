"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncTestRailInputRequirements = syncTestRailInputRequirements;
const project_case_input_requirement_service_1 = require("../db/project-case-input-requirement-service");
const project_repository_1 = require("../db/project-repository");
const testrail_input_requirements_adapter_1 = require("./testrail-input-requirements-adapter");
async function syncTestRailInputRequirements(input, dependencies = {}) {
    const adapter = dependencies.adapter ?? testrail_input_requirements_adapter_1.extractTestRailInputRequirements;
    const parsed = adapter(input.rawTestRailCase);
    if (parsed.conflicts.length > 0) {
        throw new Error(`conflicting input requirement metadata for ${parsed.conflicts.map((conflict) => conflict.key).join(", ")}`);
    }
    const requirements = input.requirements ?? parsed.requirements;
    if (requirements.length === 0)
        return { ...parsed, persisted: false };
    const resolveProjectId = dependencies.resolveProjectId ?? (async (projectSlug) => {
        const project = await (0, project_repository_1.getProjectBySlug)(projectSlug);
        return project?.id ?? null;
    });
    const projectId = await resolveProjectId(input.projectSlug);
    if (!projectId)
        throw new Error(`project not found: ${input.projectSlug}`);
    const persist = dependencies.replaceForProjectAndCase
        ?? (async (_projectId, caseId, requirements) => {
            await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)(input.projectSlug, caseId, requirements);
        });
    await persist(projectId, input.caseId, requirements);
    return { ...parsed, requirements, persisted: true };
}
