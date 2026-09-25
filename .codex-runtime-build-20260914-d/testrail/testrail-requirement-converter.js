"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertTestRailRequirements = convertTestRailRequirements;
const testrail_input_requirements_adapter_1 = require("./testrail-input-requirements-adapter");
const NAMESPACE_PLACEHOLDER = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;
function convertTestRailRequirements(input) {
    const parsed = (0, testrail_input_requirements_adapter_1.extractTestRailInputRequirements)(input.rawCase);
    const unresolvedPlaceholders = parsed.unresolvedPlaceholders.filter((key) => NAMESPACE_PLACEHOLDER.test(key));
    const status = parsed.conflicts.length > 0
        ? "conflict"
        : parsed.requirements.length > 0
            ? "proposed"
            : "empty";
    return {
        caseId: input.caseId,
        requirements: parsed.requirements,
        unresolvedPlaceholders,
        conflicts: parsed.conflicts,
        status,
        requiresApproval: true,
    };
}
