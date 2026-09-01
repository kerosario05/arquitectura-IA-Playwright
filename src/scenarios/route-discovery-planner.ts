import type { RouteDiscoveryPlanRequest, RouteDiscoveryPlanResponse, RouteDiscoveryPlanError } from "./scenario-types";

/**
 * Route Discovery Planner
 *
 * Generates a discovery plan for a HU that cannot be routed because its
 * routeProfile is missing, incompatible, or insufficient for the detected intent.
 *
 * Generic: works for any huIntent, not just transactional_document_flow.
 *
 * Does NOT execute browser navigation or persist route profiles.
 * This phase only validates the payload and returns a contract for the
 * guided route discovery that would follow.
 *
 * Next phase (future): the caller takes the plan and runs
 * run_guided_route_discovery with Playwright + AuthFlow to discover
 * the real navigation path.
 */

export function planRouteDiscovery(
  request: RouteDiscoveryPlanRequest
): RouteDiscoveryPlanResponse | RouteDiscoveryPlanError {
  const { appSlug, issueKey, huIntent, reasonCode, currentRouteProfileName } = request;

  if (!appSlug?.trim()) {
    return { ok: false, error: "missing_field", message: "appSlug is required" };
  }
  if (!issueKey?.trim()) {
    return { ok: false, error: "missing_field", message: "issueKey is required" };
  }
  if (!huIntent?.trim()) {
    return { ok: false, error: "missing_field", message: "huIntent is required" };
  }
  if (!reasonCode?.trim()) {
    return { ok: false, error: "missing_field", message: "reasonCode is required" };
  }
  if (request.discoveryTarget?.scope === "branch" &&
      (!request.discoveryTarget.branchId?.trim() || !request.discoveryTarget.sourceRequirementId?.trim())) {
    return { ok: false, error: "invalid_branch_target", message: "branch discovery requires branchId and sourceRequirementId" };
  }

  console.log(
    `[route-discovery-plan] requested appSlug=${appSlug} issue=${issueKey} huIntent=${huIntent} reason=${reasonCode}`
  );

  const result: RouteDiscoveryPlanResponse = {
    ok: true,
    discoveryType: "intent_route_discovery",
    huIntent,
    issueKey,
    appSlug,
    reasonCode,
    currentRouteProfile: currentRouteProfileName ?? "none",
    recommendedMode: "guided_route_discovery",
    requiredInputs: [
      "appSlug",
      "issueKey",
      "huIntent",
      "reasonCode",
      "jiraSummary",
      "jiraDescription"
    ],
    nextAction: "run_guided_route_discovery",
    planVersion: "1.0"
    ,discoveryTarget: request.discoveryTarget
  };

  console.log(
    `[route-discovery-plan] created discoveryType=intent_route_discovery recommendedMode=guided_route_discovery`
  );

  return result;
}
