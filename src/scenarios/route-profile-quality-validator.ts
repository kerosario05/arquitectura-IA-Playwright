/**
 * Route Profile Quality Validator
 *
 * Validates route profile quality before AI generation.
 * Determines if profile is complete enough for generating compliant scenarios.
 *
 * This is app-agnostic and works with any appSlug/routeProfile.
 * DO NOT hardcode project-specific logic.
 */

import type { McpRouteProfile, ScenarioRouteResolution } from "./scenario-types";
import type { DerivedExecutionContext } from "./route-profile-derived-context";

export type RouteProfileQualityStatus = "valid" | "incomplete" | "missing" | "low_confidence";

export type RouteProfileQualityResult = {
  appSlug: string;
  status: RouteProfileQualityStatus;
  canGenerate: boolean;
  diagnostics: Array<{
    level: "error" | "warning" | "info";
    code: string;
    message: string;
  }>;
  allowedExecutableClicks: string[];
  assertionOnlyTerms: string[];
  sensitiveActions: string[];
};

/**
 * Validate route profile quality
 */
export function validateRouteProfileQuality(
  appSlug: string,
  routeProfile: McpRouteProfile | null,
  routeResolutions: Map<string, ScenarioRouteResolution>,
  derivedContext: DerivedExecutionContext
): RouteProfileQualityResult {
  const diagnostics: RouteProfileQualityResult["diagnostics"] = [];

  // Missing profile
  if (!routeProfile) {
    diagnostics.push({
      level: "error",
      code: "needs_route_profile",
      message: `No route profile available for appSlug=${appSlug}. Cannot generate scenarios without profile.`
    });

    return {
      appSlug,
      status: "missing",
      canGenerate: false,
      diagnostics,
      allowedExecutableClicks: [],
      assertionOnlyTerms: [],
      sensitiveActions: []
    };
  }

  // Check profile completeness
  let score = 0;
  let canGenerate = true;

  // 1. Entry steps
  if (!routeProfile.entry || routeProfile.entry.length === 0) {
    diagnostics.push({
      level: "warning",
      code: "missing_entry_steps",
      message: "Route profile has no entry steps. Entry navigation may be incomplete."
    });
  } else {
    score += 2;
  }

  // 2. Visible controls
  if (!routeProfile.visibleControls || routeProfile.visibleControls.length === 0) {
    diagnostics.push({
      level: "warning",
      code: "missing_visible_controls",
      message: "Route profile has no visible controls. Executable clicks may be limited."
    });
  } else {
    score += 2;
  }

  // 3. Executable clicks derived
  if (derivedContext.allowedExecutableClicks.length === 0) {
    diagnostics.push({
      level: "error",
      code: "no_executable_clicks",
      message: "No executable clicks could be derived from profile. Cannot generate navigation scenarios."
    });
    canGenerate = false;
  } else {
    score += 2;
  }

  // 4. Route resolutions with executable steps
  const hasExecutableSteps = Array.from(routeResolutions.values()).some(
    r => r.executableRouteSteps && r.executableRouteSteps.length > 0
  );

  if (!hasExecutableSteps && routeResolutions.size > 0) {
    diagnostics.push({
      level: "warning",
      code: "missing_executable_route_steps",
      message: "Route resolutions exist but no executable route steps found. May generate incomplete scenarios."
    });
  } else if (hasExecutableSteps) {
    score += 2;
  }

  // 5. Domain terms
  if (routeProfile.domainTerms && Object.keys(routeProfile.domainTerms).length > 0) {
    score += 1;
  }

  // 6. Aliases
  if (routeProfile.aliases && Object.keys(routeProfile.aliases).length > 0) {
    score += 1;
  }

  // 7. Check for mixed executable/assertion targets (ambiguous profile)
  if (derivedContext.allowedExecutableClicks.length > 0 && derivedContext.assertionOnlyTerms.length > 0) {
    const overlap = derivedContext.allowedExecutableClicks.filter(
      c => derivedContext.assertionOnlyTerms.includes(c)
    );
    if (overlap.length > 0) {
      diagnostics.push({
        level: "warning",
        code: "ambiguous_targets",
        message: `${overlap.length} targets appear in both executable and assertion-only lists. May cause confusion.`
      });
    }
  }

  // Determine status
  let status: RouteProfileQualityStatus;
  if (!canGenerate) {
    status = "missing";
  } else if (score >= 6) {
    status = "valid";
  } else if (score >= 3) {
    status = "incomplete";
  } else {
    status = "low_confidence";
  }

  // If incomplete or low_confidence, generate with caution
  if (status === "incomplete") {
    diagnostics.push({
      level: "info",
      code: "profile_incomplete",
      message: "Profile is incomplete but may generate limited scenarios. Review generated scenarios carefully."
    });
  } else if (status === "low_confidence") {
    diagnostics.push({
      level: "warning",
      code: "profile_low_confidence",
      message: "Profile has low confidence. Generated scenarios may be unreliable."
    });
    // Can still generate, but with warnings
  }

  return {
    appSlug,
    status,
    canGenerate: canGenerate && status !== "missing",
    diagnostics,
    allowedExecutableClicks: derivedContext.allowedExecutableClicks,
    assertionOnlyTerms: derivedContext.assertionOnlyTerms,
    sensitiveActions: derivedContext.sensitiveActions
  };
}

/**
 * Log route profile quality result
 */
export function logRouteProfileQuality(result: RouteProfileQualityResult): void {
  console.log(
    `[route-profile-quality] appSlug=${result.appSlug} ` +
    `status=${result.status} ` +
    `canGenerate=${result.canGenerate} ` +
    `allowedClicks=${result.allowedExecutableClicks.length} ` +
    `assertionTerms=${result.assertionOnlyTerms.length} ` +
    `sensitiveActions=${result.sensitiveActions.length} ` +
    `diagnostics=${result.diagnostics.length}`
  );

  for (const diag of result.diagnostics) {
    console.log(
      `[route-profile-quality] ${diag.level.toUpperCase()} ${diag.code}: ${diag.message}`
    );
  }
}
