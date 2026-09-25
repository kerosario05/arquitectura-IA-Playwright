"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticDestinationFromRouteProfile = semanticDestinationFromRouteProfile;
exports.evaluateDestinationEvidence = evaluateDestinationEvidence;
function semanticDestinationFromRouteProfile(routeProfile) {
    if (!routeProfile)
        return undefined;
    const pathname = typeof routeProfile.destinationUrl === "string" && routeProfile.destinationUrl.startsWith("/")
        ? routeProfile.destinationUrl : undefined;
    const routeKey = typeof routeProfile.destination === "string" && routeProfile.destination.trim()
        ? routeProfile.destination.trim() : undefined;
    const signals = Array.isArray(routeProfile.destinationSignals)
        ? routeProfile.destinationSignals.filter((value) => typeof value === "string") : undefined;
    if (!routeKey && !pathname && !signals?.length)
        return undefined;
    return { routeKey, pathname, destinationSignals: signals, source: "route_profile_seed", trustLevel: "declared" };
}
function evaluateDestinationEvidence(evidence) {
    const expected = evidence.expectedSemanticDestination;
    const observed = evidence.observedSemanticDestination;
    const expectedTrusted = expected?.trustLevel === "trusted" || expected?.trustLevel === "trusted_expectation";
    const routeMatch = expectedTrusted && expected?.routeKey && observed?.routeIdentity && expected.routeKey === observed.routeIdentity;
    const pathMatch = expectedTrusted && expected?.pathname && observed?.pathname && expected.pathname === observed.pathname;
    const markersMatch = expectedTrusted && expected?.semanticMarkers?.length && observed?.structuredMarkers
        && expected.semanticMarkers.every((marker) => observed.structuredMarkers?.includes(marker));
    if (evidence.transitionValidated && (evidence.routeCompatibility === true || routeMatch || pathMatch || markersMatch)) {
        return { destinationMatched: true, destinationValidation: "validated", destinationEvidenceKind: "route", destinationEvidenceSource: "trusted_route_compatibility" };
    }
    if (evidence.routeCompatibility === false && evidence.expectedRouteIdentity ||
        expectedTrusted && (expected?.routeKey || expected?.pathname) && observed && !routeMatch && !pathMatch && !markersMatch) {
        return { destinationMatched: false, destinationValidation: "mismatch", destinationEvidenceKind: "none", destinationEvidenceSource: "structured_route_mismatch" };
    }
    return { destinationMatched: false, destinationValidation: "pending", destinationEvidenceKind: evidence.transitionDetected ? "runtime_page_change" : "none", destinationEvidenceSource: evidence.transitionDetected ? "runtime_after_observation" : "no_destination_evidence" };
}
