"use strict";
/**
 * Scenario Route Resolver
 *
 * Orchestrates route resolution: validates route backing, classifies mode,
 * builds executable steps, assigns confidence, and collects diagnostics.
 *
 * Central rule: All navigation must come from route profile, not HU text.
 * If route is incomplete, return diagnostics instead of inventing steps.
 *
 * CRITICAL: Do NOT convert HU text, expected result, content sections,
 * field names, or messages into executable route steps unless routeProfile
 * explicitly marks them as executable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveScenarioRoute = resolveScenarioRoute;
const scenario_mode_classifier_1 = require("./scenario-mode-classifier");
const route_backed_scenario_builder_1 = require("./route-backed-scenario-builder");
const route_profile_derived_context_1 = require("./route-profile-derived-context");
/**
 * Create a diagnostic entry
 */
function createDiagnostic(level, code, message, context) {
    return { level, code, message, context };
}
/**
 * Collect diagnostics based on classification result
 */
function collectDiagnostics(classification, routeProfile) {
    const diagnostics = [];
    // ERROR: No route profile at all
    if (!routeProfile) {
        diagnostics.push(createDiagnostic("error", "needs_route_profile", "Route profile not found. Scenario generation blocked until route profile is defined.", { requiredDepth: classification.requiredRouteDepth }));
        return diagnostics;
    }
    // ERROR: Entry exists but list missing (skip for huComposedPath — path is self-contained)
    const isHuComposed = !!routeProfile?._huComposedPath;
    if (!isHuComposed &&
        classification.missingSteps.includes("list_target") &&
        (classification.mode === "listing_validation" || classification.mode === "detail_navigation")) {
        diagnostics.push(createDiagnostic("error", "missing_parent_route", "Entry route exists but list target is missing from route profile.", { mode: classification.mode, missingSteps: classification.missingSteps }));
    }
    // WARNING: List exists but intermediate missing
    if (classification.missingSteps.includes("intermediates")) {
        diagnostics.push(createDiagnostic("warning", "missing_intermediate_step", "Route profile missing intermediate navigation steps. Generation allowed with medium confidence.", { mode: classification.mode }));
    }
    // WARNING: Detail mode but no domainTerm
    if (classification.missingSteps.includes("domainTerm_for_selection")) {
        diagnostics.push(createDiagnostic("warning", "missing_detail_selection_step", "Detail navigation mode but route profile missing domainTerm for ordinal selection.", { mode: classification.mode }));
    }
    // INFO: Mode is unknown
    if (classification.mode === "unknown") {
        diagnostics.push(createDiagnostic("info", "unsupported_route_target", "Unable to classify scenario mode from HU intent. Generation may produce generic steps.", { detectedKeywords: [] }));
    }
    return diagnostics;
}
/**
 * Determine if generation can proceed based on diagnostics
 */
function canGenerateFromDiagnostics(diagnostics) {
    // Block if any ERROR-level diagnostic
    return !diagnostics.some(d => d.level === "error");
}
/**
 * Build missing route reason message
 */
function buildMissingRouteReason(diagnostics) {
    const errors = diagnostics.filter(d => d.level === "error");
    if (errors.length === 0)
        return undefined;
    return errors.map(e => `${e.code}: ${e.message}`).join("; ");
}
/**
 * Resolve scenario route from Jira issue and route profile
 *
 * @param issue - Jira issue with HU text (functional intent)
 * @param routeProfile - App route profile with backing evidence
 * @param appSlug - Application slug (for deriving execution context)
 * @returns ScenarioRouteResolution with mode, confidence, steps, and diagnostics
 */
function resolveScenarioRoute(issue, routeProfile, appSlug) {
    // Combine description and acceptance criteria for intent analysis
    const huText = [issue.description, issue.acceptanceCriteria || ""]
        .filter(Boolean)
        .join(" ");
    // Classify mode
    const classification = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, routeProfile);
    // Collect diagnostics
    const diagnostics = collectDiagnostics(classification, routeProfile);
    // Determine if generation can proceed
    const canGenerate = canGenerateFromDiagnostics(diagnostics);
    // Build derived execution context to get backed navigation targets
    // This ensures only backed targets become navigation steps
    const derivedContext = routeProfile
        ? (0, route_profile_derived_context_1.buildDerivedExecutionContext)(appSlug ?? "", routeProfile, new Map(), [])
        : null;
    // Build executable steps if generation allowed
    const executableRouteSteps = canGenerate && routeProfile && derivedContext
        ? (0, route_backed_scenario_builder_1.buildExecutableSteps)(classification.mode, routeProfile, huText, derivedContext.allowedExecutableClicks // Pass backed navigation targets
        )
        : [];
    // Build missing route reason if blocked
    const missingRouteReason = buildMissingRouteReason(diagnostics);
    return {
        scenarioMode: classification.mode,
        routeConfidence: classification.confidence,
        executableRouteSteps,
        diagnostics,
        canGenerate,
        missingRouteReason
    };
}
