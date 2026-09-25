"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyRecordingEnvironmentCompatibility = classifyRecordingEnvironmentCompatibility;
function normalizedText(value) {
    const normalized = value?.trim().toLowerCase();
    return normalized || undefined;
}
function originOf(value) {
    const normalized = normalizedText(value);
    if (!normalized)
        return undefined;
    try {
        return new URL(normalized).origin;
    }
    catch {
        return normalized.replace(/\/$/, "");
    }
}
function sameConfiguredValue(left, right) {
    const leftOrigin = originOf(left);
    const rightOrigin = originOf(right);
    if (!leftOrigin || !rightOrigin)
        return null;
    return leftOrigin === rightOrigin;
}
/**
 * Compares a recording's historical environment with the current project runtime.
 * Absolute URLs from a recording are evidence only; the current project configuration
 * remains the sole runtime authority.
 */
function classifyRecordingEnvironmentCompatibility(input) {
    const sqlMaterializedConsistent = input.sqlBaseUrl || input.materializedBaseUrl
        ? sameConfiguredValue(input.sqlBaseUrl, input.materializedBaseUrl)
        : null;
    const runtimeMatchesMaterializedConfig = input.runtimeBaseUrl || input.runtimeOrigin
        ? sameConfiguredValue(input.materializedBaseUrl ?? input.currentConfiguredBaseUrl, input.runtimeBaseUrl ?? input.runtimeOrigin)
        : null;
    const recordedProjectSlug = normalizedText(input.recordedProjectSlug);
    const currentProjectSlug = normalizedText(input.currentProjectSlug);
    const configuredOrigin = originOf(input.currentConfiguredOrigin ?? input.currentConfiguredBaseUrl);
    const recordedOrigin = originOf(input.recordedOrigin);
    let classification = "UNDETERMINED";
    if (recordedProjectSlug && currentProjectSlug && recordedProjectSlug !== currentProjectSlug) {
        classification = "APP_IDENTITY_MISMATCH";
    }
    else if (sqlMaterializedConsistent === false || runtimeMatchesMaterializedConfig === false) {
        classification = "PROJECT_CONFIGURATION_MISMATCH";
    }
    else if (!configuredOrigin || !recordedOrigin) {
        classification = "UNDETERMINED";
    }
    else if (configuredOrigin !== recordedOrigin) {
        classification = "STALE_ABSOLUTE_RECORDING_URL";
    }
    else {
        classification = "COMPATIBLE_CURRENT_ENV";
    }
    return {
        classification,
        portableAcrossCurrentConfig: classification === "COMPATIBLE_CURRENT_ENV" || classification === "STALE_ABSOLUTE_RECORDING_URL",
        sqlMaterializedConsistent,
        runtimeMatchesMaterializedConfig,
        historicalAbsoluteUrlIsEvidence: true,
        runtimeAuthority: "current_project_configuration",
    };
}
