export type RuntimeDestinationEvidence = {
  beforeRouteIdentity?: string;
  afterRouteIdentity?: string;
  expectedRouteIdentity?: string;
  routeCompatibility?: boolean;
  transitionDetected: boolean;
  transitionValidated: boolean;
  branchId?: string;
  sourceRequirementId?: string;
  expectedSemanticDestination?: SemanticDestinationIdentity;
  observedSemanticDestination?: ObservedDestinationIdentity;
};

export type SemanticDestinationIdentity = {
  routeKey?: string;
  pathname?: string;
  destinationSignals?: string[];
  semanticMarkers?: string[];
  source: "route_profile_seed" | "explicit_project_config" | "validated_knowledge" | "runtime_observation";
  trustLevel: "declared" | "trusted_expectation" | "trusted" | "observed";
};

export type ObservedDestinationIdentity = {
  routeIdentity?: string;
  pathname?: string;
  structuredMarkers?: string[];
  authGate?: boolean;
};

export function semanticDestinationFromRouteProfile(routeProfile: Record<string, unknown> | null | undefined): SemanticDestinationIdentity | undefined {
  if (!routeProfile) return undefined;
  const pathname = typeof routeProfile.destinationUrl === "string" && routeProfile.destinationUrl.startsWith("/")
    ? routeProfile.destinationUrl : undefined;
  const routeKey = typeof routeProfile.destination === "string" && routeProfile.destination.trim()
    ? routeProfile.destination.trim() : undefined;
  const signals = Array.isArray(routeProfile.destinationSignals)
    ? routeProfile.destinationSignals.filter((value): value is string => typeof value === "string") : undefined;
  if (!routeKey && !pathname && !signals?.length) return undefined;
  return { routeKey, pathname, destinationSignals: signals, source: "route_profile_seed", trustLevel: "declared" };
}

export function evaluateDestinationEvidence(evidence: RuntimeDestinationEvidence) {
  const expected = evidence.expectedSemanticDestination;
  const observed = evidence.observedSemanticDestination;
  const expectedTrusted = expected?.trustLevel === "trusted" || expected?.trustLevel === "trusted_expectation";
  const routeMatch = expectedTrusted && expected?.routeKey && observed?.routeIdentity && expected.routeKey === observed.routeIdentity;
  const pathMatch = expectedTrusted && expected?.pathname && observed?.pathname && expected.pathname === observed.pathname;
  const markersMatch = expectedTrusted && expected?.semanticMarkers?.length && observed?.structuredMarkers
    && expected.semanticMarkers.every((marker) => observed.structuredMarkers?.includes(marker));
  if (evidence.transitionValidated && (evidence.routeCompatibility === true || routeMatch || pathMatch || markersMatch)) {
    return { destinationMatched: true, destinationValidation: "validated" as const, destinationEvidenceKind: "route" as const, destinationEvidenceSource: "trusted_route_compatibility" };
  }
  if (evidence.routeCompatibility === false && evidence.expectedRouteIdentity ||
      expectedTrusted && (expected?.routeKey || expected?.pathname) && observed && !routeMatch && !pathMatch && !markersMatch) {
    return { destinationMatched: false, destinationValidation: "mismatch" as const, destinationEvidenceKind: "none" as const, destinationEvidenceSource: "structured_route_mismatch" };
  }
  return { destinationMatched: false, destinationValidation: "pending" as const, destinationEvidenceKind: evidence.transitionDetected ? "runtime_page_change" as const : "none" as const, destinationEvidenceSource: evidence.transitionDetected ? "runtime_after_observation" : "no_destination_evidence" };
}
