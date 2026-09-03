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

import type {
  JiraIssueSource,
  McpRouteProfile,
  ScenarioRouteResolution,
  ScenarioDiagnostic,
  DiagnosticLevel,
  DiagnosticCode
} from "./scenario-types";
import { classifyScenarioMode } from "./scenario-mode-classifier";
import { buildExecutableSteps } from "./route-backed-scenario-builder";
import { buildDerivedExecutionContext } from "./route-profile-derived-context";

/**
 * Create a diagnostic entry
 */
function createDiagnostic(
  level: DiagnosticLevel,
  code: DiagnosticCode,
  message: string,
  context?: Record<string, unknown>
): ScenarioDiagnostic {
  return { level, code, message, context };
}

/**
 * Collect diagnostics based on classification result
 */
function collectDiagnostics(
  classification: ReturnType<typeof classifyScenarioMode>,
  routeProfile: McpRouteProfile | null
): ScenarioDiagnostic[] {
  const diagnostics: ScenarioDiagnostic[] = [];

  // ERROR: No route profile at all
  if (!routeProfile) {
    diagnostics.push(
      createDiagnostic(
        "error",
        "needs_route_profile",
        "Route profile not found. Scenario generation blocked until route profile is defined.",
        { requiredDepth: classification.requiredRouteDepth }
      )
    );
    return diagnostics;
  }

  // ERROR: Entry exists but list missing (skip for huComposedPath — path is self-contained)
  const isHuComposed = !!(routeProfile as any)?._huComposedPath;
  if (
    !isHuComposed &&
    classification.missingSteps.includes("list_target") &&
    (classification.mode === "listing_validation" || classification.mode === "detail_navigation")
  ) {
    diagnostics.push(
      createDiagnostic(
        "error",
        "missing_parent_route",
        "Entry route exists but list target is missing from route profile.",
        { mode: classification.mode, missingSteps: classification.missingSteps }
      )
    );
  }

  // WARNING: List exists but intermediate missing
  if (classification.missingSteps.includes("intermediates")) {
    diagnostics.push(
      createDiagnostic(
        "warning",
        "missing_intermediate_step",
        "Route profile missing intermediate navigation steps. Generation allowed with medium confidence.",
        { mode: classification.mode }
      )
    );
  }

  // WARNING: Detail mode but no domainTerm
  if (classification.missingSteps.includes("domainTerm_for_selection")) {
    diagnostics.push(
      createDiagnostic(
        "warning",
        "missing_detail_selection_step",
        "Detail navigation mode but route profile missing domainTerm for ordinal selection.",
        { mode: classification.mode }
      )
    );
  }

  // INFO: Mode is unknown
  if (classification.mode === "unknown") {
    diagnostics.push(
      createDiagnostic(
        "info",
        "unsupported_route_target",
        "Unable to classify scenario mode from HU intent. Generation may produce generic steps.",
        { detectedKeywords: [] }
      )
    );
  }

  return diagnostics;
}

/**
 * Determine if generation can proceed based on diagnostics
 */
function canGenerateFromDiagnostics(diagnostics: ScenarioDiagnostic[]): boolean {
  // Block if any ERROR-level diagnostic
  return !diagnostics.some(d => d.level === "error");
}

/**
 * Build missing route reason message
 */
function buildMissingRouteReason(diagnostics: ScenarioDiagnostic[]): string | undefined {
  const errors = diagnostics.filter(d => d.level === "error");
  if (errors.length === 0) return undefined;

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
export function resolveScenarioRoute(
  issue: JiraIssueSource,
  routeProfile: McpRouteProfile | null,
  appSlug?: string,
): ScenarioRouteResolution {
  // Combine description and acceptance criteria for intent analysis
  const huText = [issue.description, issue.acceptanceCriteria || ""]
    .filter(Boolean)
    .join(" ");

  // Classify mode
  const classification = classifyScenarioMode(huText, routeProfile);

  // Collect diagnostics
  const diagnostics = collectDiagnostics(classification, routeProfile);

  // Determine if generation can proceed
  const canGenerate = canGenerateFromDiagnostics(diagnostics);

  // Build derived execution context to get backed navigation targets
  // This ensures only backed targets become navigation steps
  const derivedContext = routeProfile
    ? buildDerivedExecutionContext(appSlug ?? "", routeProfile, new Map(), [])
    : null;

  // Build executable steps if generation allowed
  const executableRouteSteps = canGenerate && routeProfile && derivedContext
    ? buildExecutableSteps(
        classification.mode,
        routeProfile,
        huText,
        derivedContext.allowedExecutableClicks // Pass backed navigation targets
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
