"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareRerun = prepareRerun;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mobile_scenario_generator_1 = require("../../scenarios/mobile-scenario-generator");
const mobile_route_profile_1 = require("../../mobile/mobile-route-profile");
const mobile_rerun_artifacts_1 = require("./mobile-rerun-artifacts");
const ROOT = path_1.default.resolve(__dirname, "..", "..", "..");
const ARTIFACTS_DIR = path_1.default.join(ROOT, ".artifacts", "scenario-preview-runs");
function virtualCaseToScenario(vc) {
    return {
        sourceIssueKey: vc.sourceIssueKey,
        title: vc.title,
        steps: vc.steps,
        preconditions: vc.preconditions ?? [],
        expectedResult: vc.expectedResult,
        type: vc.type ?? "Functional",
        database: "QA",
        isConverted: 0,
        automationType: vc.automationType ?? "ui_with_auth_gate",
        setupStrategy: vc.setupStrategy ?? "auth_gate",
        appSlug: vc.appSlug,
        targetAppSlug: vc.targetAppSlug,
        targetAppName: vc.targetAppName,
        routeProfile: vc.routeProfile ?? "",
        dataRequirements: vc.dataRequirements ?? "",
        nonExecutableCriteria: "",
        mcpExecutable: vc.mcpExecutable !== false,
    };
}
function loadJobMetadata(sourceDir) {
    const metaPath = path_1.default.join(sourceDir, "job.json");
    if (fs_1.default.existsSync(metaPath)) {
        try {
            return JSON.parse(fs_1.default.readFileSync(metaPath, "utf-8"));
        }
        catch {
            // ignore parse errors
        }
    }
    return {};
}
function enrichMobileScenariosForRerun(params) {
    const routeProfile = params.appSlug ? (0, mobile_route_profile_1.loadMobileRouteProfile)(params.appSlug) : null;
    const scenarios = params.scenarios.map((scenario) => {
        const derived = (0, mobile_scenario_generator_1.deriveScenarioRequiredData)(scenario.steps, routeProfile);
        const mergedByKey = new Map();
        for (const field of scenario.requiredData ?? []) {
            mergedByKey.set(`${field.kind}:${field.stepIndex}:${field.key}`, field);
        }
        for (const field of derived) {
            const key = `${field.kind}:${field.stepIndex}:${field.key}`;
            if (!mergedByKey.has(key)) {
                mergedByKey.set(key, field);
            }
        }
        return {
            ...scenario,
            requiredData: Array.from(mergedByKey.values()),
        };
    });
    return {
        ...params,
        scenarios,
    };
}
function prepareRerun(sourceJobId, mode, sourceJobTypeHint) {
    const sourceDir = path_1.default.join(ARTIFACTS_DIR, sourceJobId);
    const previewPath = path_1.default.join(sourceDir, "preview-scenarios.json");
    if (!fs_1.default.existsSync(previewPath)) {
        const mobileManifest = (0, mobile_rerun_artifacts_1.readMobileExecutionManifest)(sourceJobId);
        if (!mobileManifest) {
            if (sourceJobTypeHint === "mobile-launch-execution") {
                return {
                    ok: false,
                    error: "missing_mobile_rerun_manifest",
                    message: `Source mobile job ${sourceJobId} has no mobile execution manifest for rerun.`,
                };
            }
            return {
                ok: false,
                error: "missing_preview_scenarios",
                message: `Source job ${sourceJobId} has no preview-scenarios.json at ${previewPath}`,
            };
        }
        const enrichedMobileParams = enrichMobileScenariosForRerun(mobileManifest.params);
        const allScenarios = enrichedMobileParams.scenarios;
        if (!Array.isArray(allScenarios) || allScenarios.length === 0) {
            return {
                ok: false,
                error: "empty_mobile_scenarios",
                message: `Mobile rerun manifest for source job ${sourceJobId} contains no scenarios.`,
            };
        }
        let selectedScenarios = allScenarios;
        if (mode === "failed_only") {
            const scenarioResults = (0, mobile_rerun_artifacts_1.readMobileExecutionResults)(sourceJobId);
            if (!scenarioResults) {
                return {
                    ok: false,
                    error: "missing_mobile_results",
                    message: `Source mobile job ${sourceJobId} has no mobile execution results. Cannot determine failed scenarios. Use mode=all instead.`,
                };
            }
            const failedScenarioIds = new Set(scenarioResults
                .filter((entry) => entry.status === "failed")
                .map((entry) => entry.scenarioId));
            selectedScenarios = allScenarios.filter((scenario) => failedScenarioIds.has(scenario.scenarioId));
            if (selectedScenarios.length === 0) {
                return {
                    ok: false,
                    error: "no_failures",
                    message: `No failed mobile scenarios found in source job ${sourceJobId}. All ${allScenarios.length} scenarios passed.`,
                };
            }
        }
        const dataOverrides = enrichedMobileParams.dataOverrides
            ? Object.fromEntries(Object.entries(enrichedMobileParams.dataOverrides)
                .filter(([scenarioId]) => selectedScenarios.some((scenario) => scenario.scenarioId === scenarioId)))
            : undefined;
        return {
            ok: true,
            jobType: "mobile-launch-execution",
            mobileParams: {
                ...enrichedMobileParams,
                scenarios: selectedScenarios,
                dataOverrides,
            },
            selectedCount: selectedScenarios.length,
            totalCount: allScenarios.length,
            sourceJobId,
            rerunMode: mode,
            appSlug: enrichedMobileParams.appSlug,
        };
    }
    let allScenarios;
    try {
        allScenarios = JSON.parse(fs_1.default.readFileSync(previewPath, "utf-8"));
    }
    catch (err) {
        return { ok: false, error: "parse_error", message: `Failed to parse preview-scenarios.json: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (allScenarios.length === 0) {
        return { ok: false, error: "empty_scenarios", message: "preview-scenarios.json contains no scenarios." };
    }
    // Extract metadata from artifacts
    const metadata = loadJobMetadata(sourceDir);
    const appSlug = metadata.appSlug || allScenarios[0]?.appSlug || "unknown";
    const targetAppSlug = metadata.targetAppSlug || allScenarios[0]?.targetAppSlug || appSlug;
    const targetAppName = metadata.targetAppName || allScenarios[0]?.targetAppName || targetAppSlug;
    const sectionName = metadata.sectionName;
    const sectionSlug = metadata.sectionSlug;
    let selectedVcs;
    if (mode === "failed_only") {
        const resultsPath = path_1.default.join(sourceDir, "results.json");
        if (!fs_1.default.existsSync(resultsPath)) {
            return { ok: false, error: "missing_results", message: `Source job ${sourceJobId} has no results.json. Cannot determine failed cases. Use mode=all instead.` };
        }
        let results;
        try {
            results = JSON.parse(fs_1.default.readFileSync(resultsPath, "utf-8"));
        }
        catch (err) {
            return { ok: false, error: "parse_error", message: `Failed to parse results.json: ${err instanceof Error ? err.message : String(err)}` };
        }
        if (!results.caseResults || results.caseResults.length === 0) {
            return { ok: false, error: "no_case_results", message: "No per-case results found in results.json. Cannot filter failed cases. Use mode=all instead." };
        }
        const failedIds = new Set(results.caseResults
            .filter((c) => c.status === "failed" || c.status === "review_needed")
            .map((c) => c.id));
        selectedVcs = allScenarios.filter((vc) => failedIds.has(vc.displayId) || failedIds.has(vc.id));
        if (selectedVcs.length === 0) {
            return {
                ok: false,
                error: "no_failures",
                message: `No failed scenarios found in source job ${sourceJobId}. All ${allScenarios.length} scenarios passed.`,
            };
        }
    }
    else {
        selectedVcs = [...allScenarios];
    }
    const scenarios = selectedVcs.map(virtualCaseToScenario);
    return {
        ok: true,
        jobType: "scenario-preview",
        scenarios,
        selectedCount: scenarios.length,
        totalCount: allScenarios.length,
        sourceJobId,
        rerunMode: mode,
        appSlug,
        targetAppSlug,
        targetAppName,
        sectionName,
        sectionSlug,
        options: metadata.options,
    };
}
