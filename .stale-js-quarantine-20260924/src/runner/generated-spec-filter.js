"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAppProfile = normalizeAppProfile;
exports.getCurrentAppProfile = getCurrentAppProfile;
exports.shouldRunGeneratedSpec = shouldRunGeneratedSpec;
exports.buildGeneratedSpecSkipReason = buildGeneratedSpecSkipReason;
function normalizeAppProfile(value) {
    if (!value || !value.trim())
        return "default";
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || "default";
}
function getCurrentAppProfile() {
    return normalizeAppProfile(process.env.APP_PROFILE);
}
function shouldRunGeneratedSpec(input) {
    const current = normalizeAppProfile(input.currentProfile ?? getCurrentAppProfile());
    const spec = normalizeAppProfile(input.specProfile);
    return current === spec;
}
function buildGeneratedSpecSkipReason(input) {
    if (shouldRunGeneratedSpec(input))
        return undefined;
    const current = normalizeAppProfile(input.currentProfile ?? getCurrentAppProfile());
    const spec = normalizeAppProfile(input.specProfile);
    return `Skipped because APP_PROFILE "${current}" does not match spec profile "${spec}"`;
}
