"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const recording_environment_compatibility_1 = require("./recording-environment-compatibility");
const base = {
    recordedProjectSlug: "portalempresarial",
    recordedOrigin: "https://recorded.example.test",
    recordedEntryPath: "/login",
    currentProjectSlug: "portalempresarial",
    currentConfiguredBaseUrl: "https://recorded.example.test/login",
    currentConfiguredEntryPath: "/login",
    runtimeBaseUrl: "https://recorded.example.test/login",
    sqlBaseUrl: "https://recorded.example.test/login",
    materializedBaseUrl: "https://recorded.example.test/login",
};
(0, node_test_1.default)("same project and origin are compatible with the current environment", () => {
    const result = (0, recording_environment_compatibility_1.classifyRecordingEnvironmentCompatibility)(base);
    strict_1.default.equal(result.classification, "COMPATIBLE_CURRENT_ENV");
    strict_1.default.equal(result.portableAcrossCurrentConfig, true);
    strict_1.default.equal(result.sqlMaterializedConsistent, true);
    strict_1.default.equal(result.runtimeMatchesMaterializedConfig, true);
    strict_1.default.equal(result.runtimeAuthority, "current_project_configuration");
});
(0, node_test_1.default)("a changed recording origin is stale historical evidence, not a runtime instruction", () => {
    const result = (0, recording_environment_compatibility_1.classifyRecordingEnvironmentCompatibility)({
        ...base,
        recordedOrigin: "https://old-environment.example.test",
    });
    strict_1.default.equal(result.classification, "STALE_ABSOLUTE_RECORDING_URL");
    strict_1.default.equal(result.portableAcrossCurrentConfig, true);
    strict_1.default.equal(result.historicalAbsoluteUrlIsEvidence, true);
});
(0, node_test_1.default)("SQL and materialized runtime disagreement is a project configuration mismatch", () => {
    const result = (0, recording_environment_compatibility_1.classifyRecordingEnvironmentCompatibility)({
        ...base,
        materializedBaseUrl: "https://different-materialized.example.test/login",
    });
    strict_1.default.equal(result.classification, "PROJECT_CONFIGURATION_MISMATCH");
    strict_1.default.equal(result.sqlMaterializedConsistent, false);
    strict_1.default.equal(result.portableAcrossCurrentConfig, false);
});
(0, node_test_1.default)("a different project slug is an app identity mismatch", () => {
    const result = (0, recording_environment_compatibility_1.classifyRecordingEnvironmentCompatibility)({
        ...base,
        currentProjectSlug: "otro-proyecto",
    });
    strict_1.default.equal(result.classification, "APP_IDENTITY_MISMATCH");
    strict_1.default.equal(result.portableAcrossCurrentConfig, false);
});
(0, node_test_1.default)("a runtime origin that differs from materialized configuration is not silently repaired", () => {
    const result = (0, recording_environment_compatibility_1.classifyRecordingEnvironmentCompatibility)({
        ...base,
        runtimeOrigin: "https://runtime-drift.example.test",
        runtimeBaseUrl: undefined,
    });
    strict_1.default.equal(result.classification, "PROJECT_CONFIGURATION_MISMATCH");
    strict_1.default.equal(result.runtimeMatchesMaterializedConfig, false);
});
