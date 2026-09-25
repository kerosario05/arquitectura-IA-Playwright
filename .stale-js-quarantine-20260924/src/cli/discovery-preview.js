"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRuntimeWebBaseUrl = exports.resolveWebBaseUrl = void 0;
exports.resolvePreviewCompletion = resolvePreviewCompletion;
exports.classifyPreviewFailure = classifyPreviewFailure;
exports.resolvePreviewAppProfile = resolvePreviewAppProfile;
exports.buildPreviewFailureGroups = buildPreviewFailureGroups;
exports.buildPreviewSummaryReport = buildPreviewSummaryReport;
exports.virtualCaseToTestScenario = virtualCaseToTestScenario;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const env_1 = require("../config/env");
const testrail_client_1 = require("../clients/testrail.client");
const case_discovery_workflow_1 = require("../discovery/case-discovery-workflow");
const app_profile_1 = require("../automations/app-profile");
const runtime_web_config_1 = require("./runtime-web-config");
var runtime_web_config_2 = require("./runtime-web-config");
Object.defineProperty(exports, "resolveWebBaseUrl", { enumerable: true, get: function () { return runtime_web_config_2.resolveWebBaseUrl; } });
Object.defineProperty(exports, "resolveRuntimeWebBaseUrl", { enumerable: true, get: function () { return runtime_web_config_2.resolveRuntimeWebBaseUrl; } });
const run_evidence_recorder_1 = require("../evidence/run-evidence-recorder");
const evidence_types_1 = require("../evidence/evidence-types");
const pre_business_retry_policy_1 = require("../discovery/pre-business-retry-policy");
function resolvePreviewCompletion(workflowResult, autoPromote, recordingReplay = false) {
    const discoveryStatus = workflowResult.caseResult?.status ?? "";
    const discoveryPassed = discoveryStatus === "discovered_passed"
        || discoveryStatus === "repaired_passed"
        || discoveryStatus === "discovered_partial";
    const specGeneration = workflowResult.specGeneration;
    const promotionAllowed = specGeneration?.promotionAllowed === true;
    const specWritten = specGeneration?.specWritten === true;
    const finalSpecOrigin = specGeneration?.finalSpec?.origin ?? null;
    const fallbackUsed = Boolean(specGeneration?.finalSpec?.fallback?.applied);
    const aiAttempts = specGeneration?.invocationsConsumed ?? specGeneration?.invocations ?? 0;
    const aiInvoked = aiAttempts > 0;
    const specGenerationAttempts = specGeneration?.specGenerationAttempts ?? aiAttempts;
    const specRepairAttempts = specGeneration?.specRepairAttempts ?? Math.max(0, specGenerationAttempts - 1);
    const firstPassPromotion = specGeneration?.firstPassPromotion ?? (promotionAllowed && specRepairAttempts === 0);
    const oracleTypes = specGeneration?.oracleTypes ?? [];
    const provider = specGeneration?.provider ?? null;
    const model = specGeneration?.model ?? null;
    const specEligible = recordingReplay && discoveryPassed;
    const specGenerationInvoked = aiInvoked || Boolean(specGeneration);
    const specEligibilityReason = specEligible
        ? "recording_spec_generation_deferred_until_explicit_product_action"
        : recordingReplay
            ? "functional_discovery_not_passed"
            : "not_recording_replay";
    const failedSpecGate = Object.entries(specGeneration?.validation ?? {})
        .find(([, status]) => status === "failed")?.[0];
    const automationReady = autoPromote
        ? discoveryPassed
            && workflowResult.promotionStatus === "promoted"
            && promotionAllowed
            && specWritten
            && typeof workflowResult.specPath === "string"
            && workflowResult.specPath.length > 0
        : discoveryPassed;
    const partialSteps = workflowResult.caseResult?.steps ?? [];
    const partialDiscoveryHasValidEvidence = discoveryStatus === "discovered_partial"
        && partialSteps.length > 0
        && workflowResult.caseResult?.failedAtStep == null
        && !workflowResult.caseResult?.failedTarget
        && !workflowResult.caseResult?.failedReason
        && partialSteps.every((step) => !step.error && !/failed|not_found|error/i.test(step.status ?? ""));
    const eventPassed = automationReady || partialDiscoveryHasValidEvidence;
    return {
        eventStatus: eventPassed ? "passed" : "failed",
        automationReady,
        promotionAllowed,
        specWritten,
        specGenerationStatus: autoPromote
            ? (automationReady ? "passed" : "failed")
            : (specEligible ? "deferred" : "not_applicable"),
        specEligible,
        specGenerationInvoked,
        specEligibilityReason,
        finalSpecOrigin,
        fallbackUsed,
        aiInvoked,
        aiAttempts,
        specGenerationAttempts,
        specRepairAttempts,
        firstPassPromotion,
        oracleTypes,
        provider,
        model,
        reason: autoPromote
            ? automationReady
                ? "automation_ready"
                : !discoveryPassed
                    ? "blocking_failures"
                    : failedSpecGate
                        ? `spec_gate_failed:${failedSpecGate}`
                        : workflowResult.promotionStatus !== "promoted"
                            ? `promotion_status:${workflowResult.promotionStatus ?? "unknown"}`
                            : !promotionAllowed
                                ? "spec_generation_not_allowed"
                                : !specWritten
                                    ? "spec_not_written"
                                    : "promoted_spec_path_missing"
            : specEligible
                ? specEligibilityReason
                : discoveryStatus === "discovered_partial"
                    ? "observable_assertion_requires_discovery"
                    : discoveryPassed
                        ? "all_targets_validated"
                        : "blocking_failures",
    };
}
function classifyPreviewFailure(caseRes) {
    const errorMsg = String(caseRes.error ?? "").toLowerCase();
    const promotionReason = String(caseRes.promotionReason ?? "").toLowerCase();
    const joined = `${errorMsg} ${promotionReason}`;
    // Check for conditional assertion without data requirement first
    if (joined.includes("conditional_assertion_without_data") || caseRes.conditionalAssertion && caseRes.conditionalRisk === "high") {
        return { failureType: "conditional_assertion_without_data", phase: "assertion_validation" };
    }
    // Check for unstable assertion risk
    if (joined.includes("unstable_assertion_risk")) {
        return { failureType: "unstable_assertion_risk", phase: "assertion_validation" };
    }
    if (joined.includes("err_connection_closed") ||
        joined.includes("err_connection_reset") ||
        joined.includes("err_timed_out") ||
        joined.includes("err_name_not_resolved") ||
        joined.includes("page.goto timeout") ||
        joined.includes("browser has been closed") ||
        joined.includes("target page, context or browser has been closed")) {
        return { failureType: "environment_navigation_error", phase: "navigation_start" };
    }
    if (joined.includes("ai_repair_candidate_not_enabled") || joined.includes("candidate not enabled")) {
        return { failureType: "ai_repair_candidate_not_enabled", phase: "ai_repair" };
    }
    if (joined.includes("ai_repair_schema_invalid") || joined.includes("confidence must be numeric")) {
        return { failureType: "ai_repair_schema_invalid", phase: "ai_repair" };
    }
    if (joined.includes("ordinal_candidates_disabled") ||
        joined.includes("ordinal_selection_no_candidates") ||
        joined.includes("ordinal_selection_ambiguous") ||
        joined.includes("no_enabled_clickable_candidate") ||
        joined.includes("no_safe_candidate")) {
        return { failureType: "ordinal_selection_no_safe_candidate", phase: "ordinal_selection" };
    }
    if (caseRes.reviewNeededReason === "unsafe_action_requires_review") {
        return { failureType: "unsafe_action_requires_review", phase: "ai_repair" };
    }
    if (caseRes.reviewNeededReason === "fragile_scenario_review_needed") {
        return { failureType: "fragile_scenario_review_needed", phase: "assertion_validation" };
    }
    if (caseRes.reviewNeededReason === "conditional_assertion_without_data") {
        return { failureType: "conditional_assertion_without_data", phase: "assertion_validation" };
    }
    const assertionImportance = caseRes.assertionImportance ?? "blocking";
    if (caseRes.failedAssertions && caseRes.failedAssertions.length > 0) {
        if (assertionImportance === "contextual") {
            return { failureType: "contextual_assertion_not_found", phase: "assertion_validation" };
        }
        if (assertionImportance === "optional") {
            return { failureType: "optional_assertion_not_found", phase: "assertion_validation" };
        }
        return { failureType: "assertion_not_found_unrecovered", phase: "assertion_validation" };
    }
    if (caseRes.failedTargets && caseRes.failedTargets.length > 0) {
        return { failureType: "target_not_found", phase: "target_resolution" };
    }
    if (caseRes.promotionStatus === "not_applicable") {
        return { failureType: "promotion_not_applicable", phase: "promotion_gate" };
    }
    if (caseRes.specGenerationStatus === "failed"
        || joined.includes("spec_gate_failed")
        || joined.includes("spec_generation")
        || joined.includes("spec_not_written")
        || joined.includes("promoted_spec_path_missing")) {
        return { failureType: "spec_generation_failed", phase: "spec_generation" };
    }
    if (caseRes.promotionStatus && caseRes.promotionStatus !== "promoted") {
        return { failureType: "promotion_failed", phase: "promotion_gate" };
    }
    return { failureType: "automation_not_ready", phase: "promotion_gate" };
}
async function resolvePreviewAppProfile(cliAppSlug) {
    let resolvedAppSlug = cliAppSlug;
    let appProfileObj = undefined;
    try {
        const appProfileResult = await (0, app_profile_1.resolveAppProfile)({ cliAppSlug });
        resolvedAppSlug = appProfileResult.profile.appSlug;
        appProfileObj = {
            ...appProfileResult.profile,
            appSlug: resolvedAppSlug,
            source: "cli",
            appDir: `automations/apps/${resolvedAppSlug}`,
            configPath: `automations/apps/${resolvedAppSlug}/app.config.json`
        };
        await (0, app_profile_1.ensureAppStructure)(resolvedAppSlug);
    }
    catch (err) {
        console.log(`[discovery:preview] Could not resolve app profile for ${cliAppSlug}: ${err instanceof Error ? err.message : String(err)}`);
        appProfileObj = {
            appSlug: cliAppSlug,
            source: "cli",
            appDir: `automations/apps/${cliAppSlug}`,
            configPath: `automations/apps/${cliAppSlug}/app.config.json`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }
    return { resolvedAppSlug, appProfileObj };
}
function buildPreviewFailureGroups(results) {
    const failureGroups = {
        environment_navigation_error: 0,
        assertion_not_found_unrecovered: 0,
        contextual_assertion_not_found: 0,
        optional_assertion_not_found: 0,
        conditional_assertion_without_data: 0,
        unsafe_action_requires_review: 0,
        fragile_scenario_review_needed: 0,
        unstable_assertion_risk: 0,
        ordinal_selection_no_safe_candidate: 0,
        ai_repair_candidate_not_enabled: 0,
        ai_repair_schema_invalid: 0,
        assertion_not_found: 0,
        target_not_found: 0,
        spec_generation_failed: 0,
        promotion_failed: 0,
        automation_not_ready: 0,
        route_profile_missing: 0,
        promotion_not_applicable: 0
    };
    for (const caseRes of results) {
        if (caseRes.status !== "failed") {
            continue;
        }
        const classifiedFailure = classifyPreviewFailure(caseRes);
        const hasClassifiedFailureGroup = classifiedFailure.failureType in failureGroups;
        if (hasClassifiedFailureGroup) {
            failureGroups[classifiedFailure.failureType] += 1;
        }
        const errorMsg = String(caseRes.error ?? "").toLowerCase() + " " + String(caseRes.promotionReason ?? "").toLowerCase();
        const hasRouteProfileIssue = errorMsg.includes("routeprofile loaded=false") ||
            errorMsg.includes("routeprofile missing") ||
            errorMsg.includes("no routeprofile in app.config.json") ||
            errorMsg.includes("loaded=false") ||
            errorMsg.includes("route_profile_missing") ||
            (caseRes.failedTargets && caseRes.failedTargets.some((t) => String(t).toLowerCase().includes("routeprofile"))) ||
            (caseRes.failedAssertions && caseRes.failedAssertions.some((a) => String(a).toLowerCase().includes("routeprofile")));
        if (hasRouteProfileIssue) {
            failureGroups.route_profile_missing++;
        }
        const isPromoNotApplicable = caseRes.promotionStatus === "not_applicable" ||
            caseRes.discoveryStatus === "discovered_partial" ||
            caseRes.discoveryStatus === "exploration_failed" ||
            errorMsg.includes("promotion not applicable") ||
            errorMsg.includes("discovered_partial") ||
            errorMsg.includes("exploration_failed");
        if (isPromoNotApplicable) {
            failureGroups.promotion_not_applicable++;
        }
        const hasAssertionFailure = (caseRes.failedAssertions && caseRes.failedAssertions.length > 0) ||
            errorMsg.includes("assertion") ||
            errorMsg.includes("no visible") ||
            errorMsg.includes("not visible") ||
            errorMsg.includes("no encontrada");
        if (hasAssertionFailure) {
            failureGroups.assertion_not_found++;
        }
        const hasTargetFailure = (caseRes.failedTargets && caseRes.failedTargets.length > 0) ||
            errorMsg.includes("target not found") ||
            errorMsg.includes("target_not_found");
        if (hasTargetFailure) {
            failureGroups.target_not_found++;
        }
    }
    return failureGroups;
}
function buildPreviewSummaryReport(results, total, failureGroups) {
    const passed = results.filter((r) => r.status === "passed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const dominantFailure = Object.entries(failureGroups)
        .filter(([, count]) => count > 0)
        .sort((a, b) => {
        const aRoot = a[0] !== "promotion_not_applicable";
        const bRoot = b[0] !== "promotion_not_applicable";
        if (aRoot !== bRoot)
            return aRoot ? -1 : 1;
        return b[1] - a[1];
    })[0]?.[0] ?? null;
    const nextFixByFailure = {
        environment_navigation_error: "Verificar disponibilidad del ambiente y conectividad antes de interpretar el fallo como funcional.",
        assertion_not_found_unrecovered: "Fortalecer assertion recovery con equivalentes, espera segura y pasos intermedios no sensibles.",
        contextual_assertion_not_found: "Reclasificar assertions auxiliares como contextual para que no bloqueen la promoción.",
        optional_assertion_not_found: "Tratar assertions opcionales como no bloqueantes cuando no son el objetivo principal del caso.",
        ordinal_selection_no_safe_candidate: "Mejorar ordinal selection para priorizar candidatos visibles, habilitados y relacionados al domainTerm.",
        ai_repair_candidate_not_enabled: "Reforzar validación de AI repair para rechazar candidatos disabled y preferir scroll/intermediate step seguro.",
        ai_repair_schema_invalid: "Normalizar y validar la respuesta de IA antes de descartarla para que un repaired_plan útil no se pierda por schema menor.",
        promotion_not_applicable: "Investigar por qué discovery quedó parcial antes de llegar a promoción aplicable.",
        target_not_found: "Revisar target resolver y route completion para targets faltantes o pasos intermedios seguros.",
        conditional_assertion_without_data: "Evitar bloquear assertions condicionales sin data requerida y marcarlas como review_needed.",
        unsafe_action_requires_review: "Marcar acciones sensibles sin candidato seguro como review_needed en lugar de tumbar el preview.",
        fragile_scenario_review_needed: "Reducir el peso de assertions secundarias o fragmentar el escenario para evitar partials espurios.",
    };
    return {
        generated: total,
        executed: results.length,
        passed,
        failed,
        passRate,
        failureGroups,
        dominantFailure,
        nextFix: dominantFailure ? (nextFixByFailure[dominantFailure] ?? nextFixByFailure.target_not_found) : null,
        topFailedCases: results
            .filter((r) => r.status === "failed")
            .slice(0, 5)
            .map((r) => ({
            caseId: r.caseId ?? r.displayId,
            title: r.title,
            failureType: r.failureType ?? classifyPreviewFailure(r).failureType,
            error: r.error ?? r.promotionReason ?? "",
        })),
    };
}
function parsePreviewArgs(argv) {
    const args = {
        input: "",
        app: "",
        routeProfile: undefined,
        headed: false,
        autoPromote: false,
        autoPom: false,
        rerunActive: false,
        overwrite: false,
        deferEvidenceConsolidation: false,
        dryRun: false,
        help: false,
    };
    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "--input" || arg === "-i") {
            const nextValue = argv[++i];
            if (!nextValue)
                throw new Error("Missing value for --input");
            args.input = nextValue;
        }
        else if (arg === "--app" || arg === "-a") {
            const nextValue = argv[++i];
            if (!nextValue)
                throw new Error("Missing value for --app");
            args.app = nextValue;
        }
        else if (arg === "--route-profile-json") {
            const nextValue = argv[++i];
            if (!nextValue)
                throw new Error("Missing value for --route-profile-json");
            const parsed = JSON.parse(nextValue);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("--route-profile-json must contain a routeProfile object");
            }
            args.routeProfile = parsed;
        }
        else if (arg === "--headed") {
            args.headed = true;
        }
        else if (arg === "--auto-promote") {
            args.autoPromote = true;
        }
        else if (arg === "--auto-pom") {
            args.autoPom = true;
        }
        else if (arg === "--rerun-active") {
            args.rerunActive = true;
        }
        else if (arg === "--overwrite") {
            args.overwrite = true;
        }
        else if (arg === "--defer-evidence-consolidation") {
            args.deferEvidenceConsolidation = true;
        }
        else if (arg === "--dry-run") {
            args.dryRun = true;
        }
        else if (arg === "--help" || arg === "-h") {
            args.help = true;
        }
        else {
            throw new Error(`Unknown argument: ${arg}`);
        }
        i++;
    }
    if (!args.help) {
        if (!args.input)
            throw new Error("--input is required");
        if (!args.app)
            throw new Error("--app is required");
    }
    return args;
}
function printPreviewHelp() {
    console.log("Usage: tsx src/cli/discovery-preview.ts --input <file> --app <slug> [options]");
    console.log("");
    console.log("Options:");
    console.log("  --input, -i        Path to preview-scenarios.json");
    console.log("  --app, -a          App slug to target");
    console.log("  --route-profile-json  Structured routeProfile from the launch payload");
    console.log("  --headed           Run browser headed");
    console.log("  --auto-promote     Promote passing cases");
    console.log("  --auto-pom         Auto-generate page objects");
    console.log("  --rerun-active     Rerun active cases");
    console.log("  --overwrite        Overwrite existing outputs");
    console.log("  --defer-evidence-consolidation  Skip run-level DOCX consolidation in this command");
    console.log("  --dry-run          Parse inputs without executing");
    console.log("  --help, -h         Show this help message");
}
async function loadVirtualCases(inputPath) {
    const content = await promises_1.default.readFile(inputPath, "utf-8");
    const data = JSON.parse(content);
    if (!Array.isArray(data)) {
        throw new Error(`Expected array of virtual cases in ${inputPath}`);
    }
    return data;
}
function virtualCaseToTestScenario(vc, routeProfile) {
    const embeddedCaseId = typeof vc.testRailCaseId === "number" && Number.isInteger(vc.testRailCaseId) && vc.testRailCaseId > 0
        ? vc.testRailCaseId
        : 0;
    const sectionName = vc.sectionName || undefined;
    const sectionSlug = vc.sectionSlug || undefined;
    const recordingActions = (vc.recordingExecutionContract?.actions ?? [])
        .filter((action) => action && typeof action.actionType === "string")
        .map((action, order) => ({
        action,
        stepIndex: Number.isInteger(action.stepIndex) ? action.stepIndex : order + 1,
    }))
        .sort((a, b) => a.stepIndex - b.stepIndex);
    const transitionInteractionIds = new Set((vc.canonicalInteractions ?? [])
        .filter((interaction) => interaction?.transitionObserved === true && interaction?.causedTransition === true)
        .map((interaction) => typeof interaction.id === "string" ? interaction.id : undefined)
        .filter((id) => Boolean(id)));
    const buildStructuredActionText = (action) => {
        const semanticField = typeof action.semanticField === "string" && action.semanticField.trim()
            ? action.semanticField.trim()
            : action.humanStep?.match(/\ben\s+["“”]([^"“”]+)["“”]/i)?.[1]?.trim();
        const field = semanticField ? ` en "${semanticField}"` : "";
        const valueKey = typeof action.valueKey === "string" && action.valueKey.trim()
            ? `[${action.valueKey.trim()}]`
            : "[runtime_value]";
        switch (action.actionType) {
            case "fill": return `Ingresar ${valueKey}${field}`;
            case "select": return `Seleccionar ${valueKey}${field}`;
            case "click": return semanticField
                ? `Presionar "${semanticField}"`
                : action.humanStep?.trim() || "click";
            case "check": return semanticField ? `check "${semanticField}"` : "check";
            case "uncheck": return "uncheck";
            default: return action.humanStep?.trim() || action.actionType;
        }
    };
    const refsByStep = new Map();
    for (const ref of vc.stepRequirementRefs ?? []) {
        const refs = refsByStep.get(ref.stepIndex) ?? [];
        refs.push(ref.requirementId);
        refsByStep.set(ref.stepIndex, refs);
    }
    return {
        source: embeddedCaseId > 0 ? "testrail" : "jira",
        externalId: embeddedCaseId > 0 ? `C${embeddedCaseId}` : vc.displayId,
        caseId: embeddedCaseId,
        title: vc.title,
        preconditions: vc.preconditions.join("\n"),
        authIntent: vc.authIntent,
        negativeOracle: vc.negativeOracle,
        steps: recordingActions.length > 0 ? recordingActions.map(({ action: contractAction, stepIndex }) => {
            const requirementRefs = refsByStep.get(stepIndex) ?? refsByStep.get(stepIndex - 1);
            const canonicalPolarities = (requirementRefs ?? [])
                .map((requirementId) => vc.canonicalRequirements?.find((requirement) => requirement.requirementId === requirementId)?.polarity)
                .filter((polarity) => Boolean(polarity));
            const polarity = canonicalPolarities.length > 0 && new Set(canonicalPolarities).size === 1
                ? canonicalPolarities[0]
                : (!vc.negativeOracle && transitionInteractionIds.has(contractAction.interactionId ?? "")
                    ? "positive"
                    : undefined);
            return {
                index: stepIndex,
                action: buildStructuredActionText(contractAction),
                description: buildStructuredActionText(contractAction),
                expected: "",
                dataHints: [],
                ...(requirementRefs && requirementRefs.length > 0 ? { requirementRefs: [...requirementRefs] } : {}),
                ...(polarity ? { polarity } : {}),
                ...(contractAction?.valueKey ? { valueKey: contractAction.valueKey } : {}),
                ...(contractAction?.entityScope ? { entityScope: contractAction.entityScope } : {}),
                ...(contractAction?.rowRelation ? { rowRelation: contractAction.rowRelation } : {}),
                ...(contractAction?.semanticField && contractAction.actionType === "select" ? { selectionField: contractAction.semanticField } : {}),
                ...(contractAction?.technicalTargetRef ? { technicalTargetRef: contractAction.technicalTargetRef } : {}),
                ...(contractAction?.technicalTargetRefs ? { technicalTargetRefs: [...contractAction.technicalTargetRefs] } : {}),
            };
        }) : vc.steps.map((step, index) => ({
            index,
            action: step,
            expected: "",
            dataHints: [],
        })),
        sectionName,
        sectionSlug,
        sectionId: vc.sectionId,
        routeProfile: routeProfile ?? vc.routeProfile,
        functionalBranch: vc.functionalBranch,
        requirementDependencies: vc.requirementDependencies,
        stepRequirementRefs: vc.stepRequirementRefs,
        stepAuthority: vc.stepAuthority,
        stepClaimTypes: vc.stepClaimTypes,
        stepClaims: vc.stepClaims,
        unsupportedFunctionalSteps: vc.unsupportedFunctionalSteps,
        missingPrerequisiteRequirementIds: vc.missingPrerequisiteRequirementIds,
        validation: vc.validation,
        repeatConstraintResolutions: vc.repeatConstraintResolutions,
        runtimeExecutionBlockedByData: vc.runtimeExecutionBlockedByData,
        canonicalRequirements: vc.canonicalRequirements,
        canonicalInputRequirements: vc.canonicalInputRequirements,
        expectedResultRequirementRefs: vc.expectedResultRequirementRefs,
        recordingId: vc.recordingId,
        recordedScenarioId: vc.recordedScenarioId,
        raw: {
            custom_preconds: vc.preconditions.join("\n"),
            custom_expected: vc.expectedResult,
            custom_steps: vc.steps.join("\n"),
            custom_steps_separated: vc.steps.map((step) => ({ content: step }))
        },
        ...(vc.recordingExecutionContract ? { recordingExecutionContract: vc.recordingExecutionContract } : {}),
    };
}
function getAuthenticationOutcome(workflowResult) {
    const caseResult = workflowResult?.caseResult;
    if (caseResult?.authenticationOutcome)
        return caseResult.authenticationOutcome;
    return [...(caseResult?.steps ?? [])]
        .reverse()
        .find((step) => step?.authenticationOutcome)
        ?.authenticationOutcome;
}
function getPreBusinessFailureSignals(workflowResult) {
    const caseResult = workflowResult?.caseResult ?? {};
    const authenticationOutcome = getAuthenticationOutcome(workflowResult);
    const failedReason = String(caseResult.failedReason ?? "");
    const failureClassification = authenticationOutcome?.classification ?? failedReason;
    const authStatus = authenticationOutcome?.authHttpStatus;
    const authRejected = authenticationOutcome?.classification === "AUTH_REJECTED"
        || authStatus === 401
        || authStatus === 403;
    const applicationError = failedReason === "application_error_visible"
        || (caseResult.steps ?? []).some((step) => step?.postActionOutcomeStatus === "application_error");
    const boundaryStepIndex = typeof caseResult.failedAtStep === "number" ? caseResult.failedAtStep : undefined;
    const functionalBusinessExecutionStarted = (caseResult.steps ?? []).some((step) => boundaryStepIndex !== undefined
        && step?.index > boundaryStepIndex
        && (step?.actionExecutionStatus === "executed" || step?.postActionOutcomeStatus === "success"));
    const oracleEvaluationStarted = (caseResult.steps ?? []).some((step) => step?.assertionStatus !== undefined || step?.assertionClassification !== undefined);
    return {
        businessSurfaceReached: authenticationOutcome?.businessSurfaceReached === true,
        failureClassification,
        authRejected,
        applicationError,
        functionalBusinessExecutionStarted,
        oracleEvaluationStarted,
        authStatus,
        postLoginSurface: authenticationOutcome?.postLoginSurface,
    };
}
async function runPreviewCase(vc, args, appSlug, appProfileObj, index, total, evidenceRunId, executionSource = "cli", effectiveBaseUrl) {
    const outputDir = node_path_1.default.resolve(`./.artifacts/preview/${vc.displayId}/${new Date().toISOString().replace(/[:.]/g, "-")}`);
    // Emit JSON line for progress tracking (FASE 4)
    console.log(JSON.stringify({
        type: "case_started",
        caseId: vc.displayId,
        title: vc.title,
        index: index + 1,
        total,
    }));
    console.log(`\n[discovery:preview] starting ${vc.displayId}: ${vc.title}`);
    console.log(`[discovery:preview] appSlug=${appSlug} outputDir=${outputDir}`);
    let workflowResult;
    try {
        const scenario = virtualCaseToTestScenario(vc, args.routeProfile);
        const testRailConfig = (0, env_1.requireTestRailConfig)(env_1.config);
        const trClient = new testrail_client_1.TestRailClient(testRailConfig);
        // Build per-app config that preserves project baseUrl (fail-closed, no fallback to env default)
        const discoveryConfig = effectiveBaseUrl
            ? { ...env_1.config, app: { ...env_1.config.app, baseUrl: effectiveBaseUrl, appProfile: appSlug } }
            : env_1.config;
        if (effectiveBaseUrl) {
            const safe = new URL(effectiveBaseUrl);
            console.log(`[web:base-url] appSlug=${appSlug} source=app_config origin=${safe.origin} pathname=${safe.pathname} fallbackUsed=false`);
        }
        // Per-scenario dataOverrides and suggestedData (generic, per-scenario isolated)
        const scenarioOverrides = vc.dataOverrides;
        const recordingRuntimeEntries = vc.recordingExecutionContract?.runtimeInputRequirements
            .filter((requirement) => typeof requirement.valueKey === "string" && typeof requirement.value === "string")
            .map((requirement) => ({
            key: String(requirement.valueKey),
            value: String(requirement.value),
            source: String(requirement.source ?? "recording_dataset"),
            sensitive: requirement.sensitive === true,
            verified: requirement.resolved === true,
            provenance: "recording_dataset",
            valueRole: String(requirement.valueRole ?? "action_input"),
        })) ?? [];
        let scenarioSuggested;
        const vcDataReq = vc.dataRequirements;
        if (Array.isArray(vcDataReq)) {
            const map = {};
            for (const r of vcDataReq) {
                if (r && r.key && r.suggestedValue !== undefined && String(r.suggestedValue).trim() !== "")
                    map[r.key] = String(r.suggestedValue);
            }
            if (Object.keys(map).length > 0)
                scenarioSuggested = map;
        }
        if (scenarioOverrides)
            console.log(`[web:dataOverrides] scenario=${vc.displayId} overrides=${Object.keys(scenarioOverrides).join(",")}`);
        const scenarioAttempts = {
            attemptCount: 0,
            retryUsed: false,
        };
        for (let attempt = 1; attempt <= pre_business_retry_policy_1.MAX_SCENARIO_ATTEMPTS; attempt += 1) {
            const attemptOutputDir = attempt === 1
                ? outputDir
                : node_path_1.default.join(outputDir, `attempt-${attempt}`);
            scenarioAttempts.attemptCount = attempt;
            console.log(`[scenario-attempt] scenario=${vc.displayId} scenarioAttempt=${attempt}/${pre_business_retry_policy_1.MAX_SCENARIO_ATTEMPTS} outputDir=${attemptOutputDir}`);
            workflowResult = await (0, case_discovery_workflow_1.runCaseDiscoveryWorkflow)({
                scenario,
                headed: args.headed,
                executionSource,
                outputDir: attemptOutputDir,
                autoPromote: args.autoPromote,
                promotionDryRun: args.dryRun,
                promotionStrict: true,
                requirePromotionApproval: false,
                overwrite: args.overwrite,
                autoPom: args.autoPom,
                // Recording replay is driven by its canonical runtime contract. It must not
                // fall through to the global AI auto-repair setting after a locator miss.
                autoRepair: !(vc.recordingId || vc.automationType === "recorded_session"),
                testRailClient: trClient,
                appProfile: appProfileObj,
                config: discoveryConfig,
                runId: evidenceRunId,
                scenarioDataOverrides: scenarioOverrides,
                scenarioSuggestedData: scenarioSuggested,
                runtimeEntries: recordingRuntimeEntries,
            });
            const signals = getPreBusinessFailureSignals(workflowResult);
            scenarioAttempts.businessSurfaceReached = signals.businessSurfaceReached;
            scenarioAttempts.authStatus = signals.authStatus;
            scenarioAttempts.postLoginSurface = signals.postLoginSurface;
            if (workflowResult.caseResult?.status !== "discovered_passed" && workflowResult.caseResult?.status !== "repaired_passed") {
                const failure = String(workflowResult.caseResult?.failedReason ?? signals.failureClassification ?? "unknown");
                if (attempt === 1)
                    scenarioAttempts.attempt1Failure = failure;
                if (attempt === 2)
                    scenarioAttempts.attempt2Failure = failure;
            }
            const retryAllowed = (0, pre_business_retry_policy_1.shouldRetryScenario)({ ...signals, attempt });
            if (!retryAllowed)
                break;
            scenarioAttempts.retryUsed = true;
            scenarioAttempts.retryReason = "transient_pre_business_auth_navigation";
            scenarioAttempts.previousAttemptFailure = scenarioAttempts.attempt1Failure;
            console.log(`[scenario-attempt] scenario=${vc.displayId} scenarioAttempt=${attempt}/${pre_business_retry_policy_1.MAX_SCENARIO_ATTEMPTS} retry=true reason=${scenarioAttempts.retryReason} freshContext=true`);
        }
        const discoveryStatus = workflowResult.caseResult.status;
        const completion = resolvePreviewCompletion(workflowResult, args.autoPromote, Boolean(vc.recordingId || vc.automationType === "recorded_session"));
        const isPassed = completion.eventStatus === "passed";
        const eventStatus = completion.eventStatus;
        scenarioAttempts.finalStatus = isPassed ? "passed" : "failed";
        console.log(`[preview-status-map] discoveryStatus=${discoveryStatus} eventStatus=${eventStatus} automationReady=${completion.automationReady} reason=${completion.reason}`);
        // Build compact step results projection (no secrets, no form values)
        const cr = workflowResult.caseResult;
        const stepResults = (cr.steps || []).map(s => ({
            stepIndex: s.index,
            action: s.action ?? undefined,
            target: s.targetText ?? undefined,
            status: s.status ?? undefined,
            reason: s.error ?? undefined,
            evidencePath: s.evidencePath ?? undefined,
        }));
        // Emit JSON line for progress tracking
        console.log(JSON.stringify({
            type: "case_finished",
            caseId: vc.displayId,
            status: eventStatus,
            discoveryStatus,
            specGenerationStatus: completion.specGenerationStatus,
            specEligible: completion.specEligible,
            specGenerationInvoked: completion.specGenerationInvoked,
            specEligibilityReason: completion.specEligibilityReason,
            automationReady: completion.automationReady,
            promotionAllowed: completion.promotionAllowed,
            specWritten: completion.specWritten,
            finalSpecOrigin: completion.finalSpecOrigin,
            fallbackUsed: completion.fallbackUsed,
            aiInvoked: completion.aiInvoked,
            aiAttempts: completion.aiAttempts,
            specGenerationAttempts: completion.specGenerationAttempts,
            specRepairAttempts: completion.specRepairAttempts,
            firstPassPromotion: completion.firstPassPromotion,
            oracleTypes: completion.oracleTypes,
            provider: completion.provider,
            model: completion.model,
            scenarioAttempts,
            failedAtStep: cr.failedAtStep,
            failedTarget: cr.failedTarget,
            failedReason: cr.failedReason,
            evidenceDir: cr.evidenceDir,
            stepResults,
        }));
        console.log(`[case-finished-enriched] caseId=${vc.displayId} hasFailedAtStep=${cr.failedAtStep != null} hasFailedTarget=${cr.failedTarget != null} hasFailedReason=${cr.failedReason != null} hasEvidenceDir=${cr.evidenceDir != null} stepResults=${stepResults.length}`);
        console.log(`[discovery:preview] completed ${vc.displayId} status=${eventStatus} discoveryStatus=${discoveryStatus}`);
        const failedSteps = workflowResult.caseResult.steps.filter((s) => s.status !== "found" && s.status !== "satisfied_by_previous_assertion" && s.status !== "satisfied_by_children" && s.status !== "skipped" && s.status !== "skipped_after_completion" && s.status !== "skipped_redundant");
        const isAssertionStep = (action) => {
            const act = action.toLowerCase();
            if (["asserttext", "assertvisible", "assertexists"].includes(act.replace(/\s+/g, "")))
                return true;
            return /\b(validar|verificar|assert|visible|mostrar|muestra|show|confirmacion|confirmation|detalle|resumen|formulario|catalogo|catalog|carrito|cart)\b/i.test(action);
        };
        const failedTargets = failedSteps
            .filter((s) => !isAssertionStep(s.action))
            .map((s) => s.targetText ?? s.action);
        const failedAssertions = failedSteps
            .filter((s) => isAssertionStep(s.action))
            .map((s) => s.targetText ?? s.action);
        // Extract assertion recovery metadata from steps
        const assertionRecoverySteps = failedSteps.filter((s) => isAssertionStep(s.action));
        const recoveryAttempts = assertionRecoverySteps.flatMap((s) => s.recoveryAttempts ?? []);
        const recoveredBy = assertionRecoverySteps.find((s) => s.recoveredBy)?.recoveredBy;
        const assertionImportance = assertionRecoverySteps.find((s) => s.assertionImportance)?.assertionImportance;
        const conditionalAssertion = assertionRecoverySteps.some((s) => s.conditionalAssertion);
        const conditionalRisk = assertionRecoverySteps.find((s) => s.conditionalRisk)?.conditionalRisk;
        const failedCaseResult = {
            id: vc.id,
            caseId: vc.displayId,
            displayId: vc.displayId,
            title: vc.title,
            status: eventStatus,
            discoveryStatus: workflowResult.caseResult.status,
            promotionStatus: workflowResult.promotionStatus,
            promotionReason: workflowResult.promotionReason || (isPassed ? "" : completion.reason),
            specGenerationStatus: completion.specGenerationStatus,
            specEligible: completion.specEligible,
            specGenerationInvoked: completion.specGenerationInvoked,
            specEligibilityReason: completion.specEligibilityReason,
            automationReady: completion.automationReady,
            specWritten: completion.specWritten,
            promotionAllowed: completion.promotionAllowed,
            finalSpecOrigin: completion.finalSpecOrigin,
            fallbackUsed: completion.fallbackUsed,
            aiInvoked: completion.aiInvoked,
            aiAttempts: completion.aiAttempts,
            specGenerationAttempts: completion.specGenerationAttempts,
            specRepairAttempts: completion.specRepairAttempts,
            firstPassPromotion: completion.firstPassPromotion,
            oracleTypes: completion.oracleTypes,
            provider: completion.provider,
            model: completion.model,
            failedTargets,
            failedAssertions,
            assertionRecovery: {
                recovered: Boolean(recoveredBy),
                decision: recoveredBy,
                attempts: recoveryAttempts.length > 0 ? recoveryAttempts : undefined,
            },
            assertionImportance,
            conditionalAssertion,
            conditionalRisk,
            reviewNeededReason: conditionalAssertion && conditionalRisk === "high" ? "conditional_assertion_without_data" : undefined,
            scenarioAttempts,
            appSlug,
            routeProfileUsed: Boolean(vc.routeProfile),
            outputDir: workflowResult.outputDir,
            specPath: workflowResult.specPath,
            durationMs: workflowResult.durationMs,
        };
        console.log(`[preview-case-finish] caseId=${vc.displayId} eventStatus=${eventStatus} emitted=true duplicate=false`);
        if (isPassed) {
            return failedCaseResult;
        }
        const classifiedFailure = classifyPreviewFailure(failedCaseResult);
        return {
            ...failedCaseResult,
            failureType: classifiedFailure.failureType,
            phase: classifiedFailure.phase,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[discovery:preview] ${vc.displayId} failed: ${message}`);
        // Emit JSON line for progress tracking
        const crCatch = workflowResult?.caseResult;
        console.log(JSON.stringify({
            type: "case_finished",
            caseId: vc.displayId,
            status: "failed",
            error: message,
            rawError: message,
            failedReason: "execution_exception",
            ...(crCatch?.evidenceDir ? { evidenceDir: crCatch.evidenceDir } : {}),
            ...(crCatch?.steps?.length ? {
                stepResults: crCatch.steps.map((s) => ({
                    stepIndex: s.index,
                    action: s.action ?? undefined,
                    target: s.targetText ?? undefined,
                    status: s.status ?? undefined,
                    reason: s.error ?? undefined,
                    evidencePath: s.evidencePath ?? undefined,
                }))
            } : {}),
        }));
        const failedCaseResult = {
            id: vc.id,
            caseId: vc.displayId,
            displayId: vc.displayId,
            title: vc.title,
            status: "failed",
            error: message,
            appSlug,
            routeProfileUsed: Boolean(vc.routeProfile),
            failedTargets: [],
            failedAssertions: [],
        };
        const classifiedFailure = classifyPreviewFailure(failedCaseResult);
        return {
            ...failedCaseResult,
            failureType: classifiedFailure.failureType,
            phase: classifiedFailure.phase,
        };
    }
}
const TECHNICAL_SLUGS = new Set(["tests", "test", "default", "unknown", "undefined", "null"]);
async function consolidateRunEvidence(runId, appSlug, sectionSlug, sectionName, results) {
    try {
        const evidenceConfig = (0, evidence_types_1.loadEvidenceConfig)();
        if (!evidenceConfig.enabled || !evidenceConfig.docxEnabled) {
            console.log(`[evidence:run] skipped runId=${runId} reason=evidence_disabled`);
            return;
        }
        console.log(`[evidence:run] starting consolidation runId=${runId} appSlug=${appSlug} sectionSlug=${sectionSlug || "default-section"}`);
        const runRecorder = new run_evidence_recorder_1.RunEvidenceRecorder({
            appSlug,
            sectionSlug: sectionSlug || "default-section",
            sectionName,
            runId,
        });
        await runRecorder.start();
        // Scan evidence directory for scenario evidence.json files
        const evidenceRoot = evidenceConfig.outputRoot;
        const sectionSlugNormalized = sectionSlug || "default-section";
        const runDir = node_path_1.default.join(evidenceRoot, appSlug, sectionSlugNormalized, "runs", runId, "scenarios");
        console.log(`[evidence:run] searching for scenarios in runDir=${runDir}`);
        const fsSync = await Promise.resolve().then(() => __importStar(require("node:fs")));
        if (fsSync.existsSync(runDir)) {
            const scenarioDirs = fsSync.readdirSync(runDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            console.log(`[evidence:run] found ${scenarioDirs.length} scenario directories: ${scenarioDirs.join(", ")}`);
            for (const scenarioDir of scenarioDirs) {
                const evidenceJsonPath = node_path_1.default.join(runDir, scenarioDir, "evidence.json");
                if (fsSync.existsSync(evidenceJsonPath)) {
                    console.log(`[evidence:run] loading scenario evidence from ${evidenceJsonPath}`);
                    await runRecorder.addScenarioFromFile(evidenceJsonPath);
                }
                else {
                    console.log(`[evidence:run] evidence.json not found in ${scenarioDir}`);
                }
            }
        }
        else {
            console.log(`[evidence:run] runDir does not exist: ${runDir}`);
        }
        if (results.length > 0) {
            console.log(`[evidence:run] applying ${results.length} status overrides from preview results`);
            for (const result of results) {
                const scenarioId = result.displayId ?? result.caseId;
                if (!scenarioId || !result.status)
                    continue;
                runRecorder.overrideScenarioStatus(scenarioId, result.status, "case_finished");
            }
        }
        await runRecorder.finish();
        console.log(`[evidence:run] consolidated runId=${runId} appSlug=${appSlug} sectionSlug=${sectionSlugNormalized}`);
    }
    catch (err) {
        console.log(`[evidence:run] consolidation failed runId=${runId}: ${err.message}`);
    }
}
function isTechnicalSlug(slug) {
    return TECHNICAL_SLUGS.has(slug.trim().toLowerCase());
}
async function hasValidAppConfig(slug) {
    try {
        const configPath = node_path_1.default.resolve(`automations/apps/${slug}/app.config.json`);
        const stat = await promises_1.default.stat(configPath).catch(() => null);
        if (!stat)
            return false;
        const content = await promises_1.default.readFile(configPath, "utf-8");
        const config = JSON.parse(content);
        const rp = config.routeProfile;
        return rp && typeof rp === "object" && (Object.keys(rp.domainTerms ?? {}).length > 0 || (rp.entry ?? []).length > 0);
    }
    catch {
        return false;
    }
}
async function main() {
    const args = parsePreviewArgs(process.argv.slice(2));
    if (args.help) {
        printPreviewHelp();
        return;
    }
    // Read EVIDENCE_RUN_ID from environment (set by scenario-preview-runner)
    // If not set, generate one for standalone mode
    let evidenceRunId = process.env.EVIDENCE_RUN_ID;
    let runIdMode = "qalab";
    if (!evidenceRunId) {
        // Generate runId for standalone execution
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        evidenceRunId = `preview-${timestamp}`;
        runIdMode = "standalone_generated";
    }
    const executionSource = runIdMode === "qalab" ? "qalab" : "cli";
    console.log(`[discovery:preview] evidenceRunId=${evidenceRunId} mode=${runIdMode}`);
    console.log(`[discovery:preview] app=${args.app}`);
    console.log("[discovery:preview] Starting preview execution");
    console.log(`[discovery:preview] input=${args.input}`);
    console.log(`[discovery:preview] app=${args.app}`);
    console.log(`[discovery:preview] headed=${args.headed}`);
    console.log(`[discovery:preview] autoPromote=${args.autoPromote}`);
    console.log(`[discovery:preview] autoPom=${args.autoPom}`);
    console.log(`[discovery:preview] overwrite=${args.overwrite}`);
    console.log(`[discovery:preview] deferEvidenceConsolidation=${args.deferEvidenceConsolidation}`);
    // Load virtual cases
    const cases = await loadVirtualCases(args.input);
    console.log(`[discovery:preview] loaded ${cases.length} virtual cases`);
    console.log(`[discovery:preview] app=${args.app}`);
    // ── FASE 2 (CLI): Block technical slugs without valid routeProfile ──
    if (isTechnicalSlug(args.app)) {
        const appConfigValid = await hasValidAppConfig(args.app);
        if (!appConfigValid) {
            // Try to use VC's own appSlug as fallback
            const vcAppSlugs = [...new Set(cases.map((c) => c.appSlug).filter(Boolean))];
            let validSlug;
            for (const s of vcAppSlugs) {
                if (!isTechnicalSlug(s) && await hasValidAppConfig(s)) {
                    validSlug = s;
                    break;
                }
            }
            if (validSlug) {
                console.log(`[discovery:preview] CLI appSlug "${args.app}" is technical; falling back to VC appSlug "${validSlug}"`);
                args.app = validSlug;
            }
            else {
                const errorMessage = `AppSlug "${args.app}" is a technical/environment slug with no valid routeProfile. ` +
                    `Provide a valid functional app slug via --app.`;
                console.error(`[discovery:preview] Error: ${errorMessage}`);
                // Write results.json with error
                const resultsPath = node_path_1.default.join(node_path_1.default.dirname(args.input), "results.json");
                await promises_1.default.writeFile(resultsPath, JSON.stringify({
                    ok: false, error: "invalid_target_app_slug", message: errorMessage,
                }, null, 2), "utf-8");
                process.exit(1);
            }
        }
    }
    // Resolve app profile
    const { resolvedAppSlug, appProfileObj } = await resolvePreviewAppProfile(args.app);
    // ── [web:base-url] Fail-closed resolution — appSlug → app_config → baseUrl must be preserved ──
    let webBase;
    try {
        webBase = await (0, runtime_web_config_1.resolveRuntimeWebBaseUrl)(resolvedAppSlug);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        const resultsPath = node_path_1.default.join(node_path_1.default.dirname(args.input), "results.json");
        await promises_1.default.writeFile(resultsPath, JSON.stringify({ ok: false, error: "missing_base_url", message }, null, 2), "utf-8");
        process.exit(1);
    }
    // Execute each case in series
    const results = [];
    let passed = 0;
    let failed = 0;
    let automationReady = 0;
    let specsPromoted = 0;
    for (let i = 0; i < cases.length; i++) {
        const vc = cases[i];
        const result = await runPreviewCase(vc, args, resolvedAppSlug, appProfileObj, i, cases.length, evidenceRunId, executionSource, webBase.effective);
        results.push(result);
        if (result.status === "passed")
            passed++;
        else
            failed++;
        if (result.automationReady)
            automationReady += 1;
        if (result.specWritten)
            specsPromoted += 1;
    }
    // Consolidate run evidence into single DOCX unless an upstream orchestrator requested deferral
    if (args.deferEvidenceConsolidation) {
        console.log(`[evidence:run] skipped runId=${evidenceRunId} reason=deferred_consolidation`);
    }
    else {
        const firstCase = cases[0];
        const sectionSlug = firstCase?.sectionSlug;
        const sectionName = firstCase?.sectionName;
        await consolidateRunEvidence(evidenceRunId, resolvedAppSlug, sectionSlug, sectionName, results);
    }
    // Aggregate failure groups (FASE 5)
    const failureGroups = buildPreviewFailureGroups(results);
    const report = buildPreviewSummaryReport(results, cases.length, failureGroups);
    const result = {
        ok: failed === 0,
        total: cases.length,
        passed,
        failed,
        cases: results,
        summary: {
            total: cases.length,
            completed: results.length,
            passed,
            failed,
            automationReady,
            specsPromoted,
            passRate: report.passRate,
            failureGroups,
            dominantFailure: report.dominantFailure,
            nextFix: report.nextFix,
        },
        failureGroups,
        results: results,
        topFailedCases: report.topFailedCases,
        dominantFailure: report.dominantFailure,
        nextFix: report.nextFix,
    };
    // Write results
    const outputDir = node_path_1.default.dirname(args.input);
    const resultsPath = node_path_1.default.join(outputDir, "results.json");
    await promises_1.default.writeFile(resultsPath, JSON.stringify(result, null, 2), "utf-8");
    console.log(`\n[discovery:preview] Results: ${passed} passed, ${failed} failed out of ${cases.length}`);
    if (args.autoPromote) {
        console.log(`[discovery:preview] automationReady=${automationReady} specsPromoted=${specsPromoted} total=${cases.length}`);
    }
    console.log(`[discovery:preview] Results saved to ${resultsPath}`);
    if (failed > 0) {
        process.exit(1);
    }
}
const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("discovery-preview.ts");
if (isMainModule) {
    main().catch((err) => {
        console.error(`[discovery:preview] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
}
