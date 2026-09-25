"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeAutomationFileName = sanitizeAutomationFileName;
exports.buildAutomationId = buildAutomationId;
exports.buildAutomationPaths = buildAutomationPaths;
exports.buildPromotedAutomationPaths = buildPromotedAutomationPaths;
exports.determineAutomationStatus = determineAutomationStatus;
const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*]/g;
const MULTIPLE_HYPHENS = /-+/g;
function sanitizeAutomationFileName(value) {
    let result = value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\-_]/g, "-")
        .replace(INVALID_WINDOWS_CHARS, "-")
        .replace(/_/g, "-")
        .replace(MULTIPLE_HYPHENS, "-")
        .replace(/^-+|-+$/g, "");
    if (result.length > 120) {
        result = result.substring(0, 120).replace(/-+$/g, "");
    }
    return result || "automation";
}
function buildAutomationId(input) {
    const parts = [];
    if (input.externalId) {
        parts.push(sanitizeAutomationFileName(input.externalId.trim()));
    }
    else if (input.caseId !== undefined && input.caseId !== null) {
        parts.push(String(input.caseId));
    }
    const sanitizedTitle = sanitizeAutomationFileName(input.title);
    if (parts.length > 0) {
        parts.push(sanitizedTitle);
    }
    else {
        parts.push(sanitizedTitle);
    }
    return parts.join("-");
}
function buildAutomationPaths(id, outputRoot) {
    const root = outputRoot ?? ".";
    const planDir = `${root}/automations/plans`;
    const specDir = `${root}/tests/generated`;
    return {
        planDir,
        specDir,
        planPath: `${planDir}/${id}.plan.json`,
        specPath: `${specDir}/${id}.spec.ts`
    };
}
function buildPromotedAutomationPaths(appSlug, automationId) {
    const planDir = `automations/apps/${appSlug}/plans`;
    const specDir = `automations/apps/${appSlug}/cases/${automationId}`;
    return {
        planDir,
        specDir,
        planPath: `${planDir}/${automationId}.plan.json`,
        specPath: `${specDir}/case.spec.ts`
    };
}
function determineAutomationStatus(planStatus, source) {
    if (planStatus === "validated") {
        return "active";
    }
    return "draft";
}
