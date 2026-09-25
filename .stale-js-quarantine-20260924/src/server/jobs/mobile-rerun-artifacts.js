"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMobileLaunchExecutionParams = normalizeMobileLaunchExecutionParams;
exports.getMobileExecutionManifestPath = getMobileExecutionManifestPath;
exports.getMobileExecutionResultsPath = getMobileExecutionResultsPath;
exports.persistMobileExecutionManifest = persistMobileExecutionManifest;
exports.readMobileExecutionManifest = readMobileExecutionManifest;
exports.persistMobileExecutionResults = persistMobileExecutionResults;
exports.readMobileExecutionResults = readMobileExecutionResults;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const mobile_text_normalization_1 = require("../../mobile/mobile-text-normalization");
const ROOT = node_path_1.default.resolve(__dirname, "..", "..", "..");
const MOBILE_RERUN_ARTIFACTS_DIR = node_path_1.default.join(ROOT, ".artifacts", "mobile-launch-runs");
function normalizeMobileScenarioText(scenario) {
    return {
        ...scenario,
        scenarioId: (0, mobile_text_normalization_1.repairUtf8Mojibake)(scenario.scenarioId),
        title: (0, mobile_text_normalization_1.repairUtf8Mojibake)(scenario.title),
        steps: scenario.steps.map((step) => ({
            ...step,
            description: typeof step.description === "string" ? (0, mobile_text_normalization_1.repairUtf8Mojibake)(step.description) : step.description,
            value: typeof step.value === "string" ? (0, mobile_text_normalization_1.repairUtf8Mojibake)(step.value) : step.value,
            target: step.target
                ? {
                    ...step.target,
                    value: (0, mobile_text_normalization_1.repairUtf8Mojibake)(step.target.value),
                }
                : step.target,
            requiredNextTarget: step.requiredNextTarget
                ? {
                    ...step.requiredNextTarget,
                    value: (0, mobile_text_normalization_1.repairUtf8Mojibake)(step.requiredNextTarget.value),
                }
                : step.requiredNextTarget,
        })),
        requiredData: scenario.requiredData?.map((field) => ({
            ...field,
            key: (0, mobile_text_normalization_1.repairUtf8Mojibake)(field.key),
            label: (0, mobile_text_normalization_1.repairUtf8Mojibake)(field.label),
            exampleValue: (0, mobile_text_normalization_1.repairUtf8Mojibake)(field.exampleValue),
            defaultValue: typeof field.defaultValue === "string" ? (0, mobile_text_normalization_1.repairUtf8Mojibake)(field.defaultValue) : field.defaultValue,
            options: field.options?.map((option) => (0, mobile_text_normalization_1.repairUtf8Mojibake)(option)),
            applyTargetTemplate: field.applyTargetTemplate
                ? {
                    ...field.applyTargetTemplate,
                    value: (0, mobile_text_normalization_1.repairUtf8Mojibake)(field.applyTargetTemplate.value),
                }
                : field.applyTargetTemplate,
        })),
    };
}
function normalizeMobileLaunchExecutionParams(params) {
    const normalizedScenarios = params.scenarios.map((scenario) => normalizeMobileScenarioText(scenario));
    const normalizedOverrides = params.dataOverrides
        ? Object.fromEntries(Object.entries(params.dataOverrides).map(([scenarioId, overridesByStep]) => [
            (0, mobile_text_normalization_1.repairUtf8Mojibake)(scenarioId),
            Object.fromEntries(Object.entries(overridesByStep).map(([stepIndex, value]) => [stepIndex, (0, mobile_text_normalization_1.repairUtf8Mojibake)(value)])),
        ]))
        : undefined;
    return {
        ...params,
        launchId: (0, mobile_text_normalization_1.repairUtf8Mojibake)(params.launchId),
        appSlug: (0, mobile_text_normalization_1.repairUtf8Mojibake)(params.appSlug),
        sectionSlug: typeof params.sectionSlug === "string" ? (0, mobile_text_normalization_1.repairUtf8Mojibake)(params.sectionSlug) : params.sectionSlug,
        avdName: typeof params.avdName === "string" ? (0, mobile_text_normalization_1.repairUtf8Mojibake)(params.avdName) : params.avdName,
        apkPath: typeof params.apkPath === "string" ? (0, mobile_text_normalization_1.repairUtf8Mojibake)(params.apkPath) : params.apkPath,
        appPackage: typeof params.appPackage === "string" ? (0, mobile_text_normalization_1.repairUtf8Mojibake)(params.appPackage) : params.appPackage,
        appActivity: typeof params.appActivity === "string" ? (0, mobile_text_normalization_1.repairUtf8Mojibake)(params.appActivity) : params.appActivity,
        scenarios: normalizedScenarios,
        dataOverrides: normalizedOverrides,
    };
}
function ensureMobileRerunDir(jobId) {
    const dir = node_path_1.default.join(MOBILE_RERUN_ARTIFACTS_DIR, jobId);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
function getMobileExecutionManifestPath(jobId) {
    return node_path_1.default.join(MOBILE_RERUN_ARTIFACTS_DIR, jobId, "mobile-execution-manifest.json");
}
function getMobileExecutionResultsPath(jobId) {
    return node_path_1.default.join(MOBILE_RERUN_ARTIFACTS_DIR, jobId, "mobile-execution-results.json");
}
function persistMobileExecutionManifest(jobId, params, options) {
    const dir = ensureMobileRerunDir(jobId);
    const manifestPath = node_path_1.default.join(dir, "mobile-execution-manifest.json");
    const normalized = normalizeMobileLaunchExecutionParams(params);
    const manifest = {
        kind: "mobile-launch-execution",
        schemaVersion: 1,
        jobId,
        createdAt: new Date().toISOString(),
        sourceJobId: options?.sourceJobId,
        params: normalized,
    };
    node_fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    return manifestPath;
}
function readMobileExecutionManifest(jobId) {
    const manifestPath = getMobileExecutionManifestPath(jobId);
    if (!node_fs_1.default.existsSync(manifestPath))
        return null;
    const parsed = JSON.parse(node_fs_1.default.readFileSync(manifestPath, "utf-8"));
    if (parsed?.kind !== "mobile-launch-execution" || !parsed?.params)
        return null;
    return {
        ...parsed,
        params: normalizeMobileLaunchExecutionParams(parsed.params),
    };
}
function persistMobileExecutionResults(jobId, results) {
    const dir = ensureMobileRerunDir(jobId);
    const resultsPath = node_path_1.default.join(dir, "mobile-execution-results.json");
    node_fs_1.default.writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf-8");
    return resultsPath;
}
function readMobileExecutionResults(jobId) {
    const resultsPath = getMobileExecutionResultsPath(jobId);
    if (!node_fs_1.default.existsSync(resultsPath))
        return null;
    const parsed = JSON.parse(node_fs_1.default.readFileSync(resultsPath, "utf-8"));
    if (!Array.isArray(parsed))
        return null;
    return parsed;
}
