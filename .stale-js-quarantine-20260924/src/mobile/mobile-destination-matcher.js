"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchDestinationProfile = matchDestinationProfile;
const STRONG_MARKER_KINDS = new Set([
    "resource_id",
    "content_desc",
    "heading",
]);
const WEAK_MARKER_KINDS = new Set([
    "screen_key",
    "click_target",
    "assertion_target",
    "observed_control_class",
    "fingerprint",
    "dominant_package",
]);
// ---------------------------------------------------------------------------
// NORMALIZATION
// ---------------------------------------------------------------------------
/**
 * Normalize a marker value for deterministic comparison.
 * Unicode NFC + trim + lowercase. No semantic relaxation.
 */
function normalizeMarkerValue(value) {
    return value.trim().toLowerCase().normalize("NFC");
}
// ---------------------------------------------------------------------------
// MATCHER
// ---------------------------------------------------------------------------
/**
 * Match a new observed destination against an approved profile from an authoritative binding.
 *
 * This is a PURE function — no side effects, no authority granting.
 * The matcher produces evidence; another layer decides authority.
 *
 * Requirements:
 * - binding must be validated
 * - observation must be independent (different transition from approval)
 * - package must match exactly
 * - fingerprint exact match OR 2+ exact strong markers
 *
 * @param binding - The validated authoritative binding with approved profile
 * @param newObservation - A NEW observation from runtime (independent from approval)
 * @param currentTransitionId - ID of the current transition (for self-match prevention)
 */
function matchDestinationProfile(binding, newObservation, currentTransitionId) {
    const defaultResult = {
        matched: false,
        reasonCode: "binding_missing",
        bindingId: "",
        packageMatched: false,
        fingerprintMatched: false,
        matchedStrongMarkers: [],
        independentObservation: false,
    };
    // --- Binding validation ---
    if (!binding) {
        return { ...defaultResult, reasonCode: "binding_missing" };
    }
    if (binding.validationStatus !== "validated") {
        return { ...defaultResult, bindingId: binding.bindingId, reasonCode: "binding_not_validated" };
    }
    const result = {
        matched: false,
        reasonCode: "binding_missing",
        bindingId: binding.bindingId,
        packageMatched: false,
        fingerprintMatched: false,
        matchedStrongMarkers: [],
        independentObservation: false,
    };
    // --- Independent observation check ---
    // The observation MUST be from a different transition than the one that was approved.
    if (currentTransitionId === binding.approvedFromTransitionId) {
        return { ...result, reasonCode: "self_match" };
    }
    result.independentObservation = true;
    // --- Observation validation ---
    if (!newObservation) {
        return { ...result, reasonCode: "no_markers" };
    }
    if (!newObservation.markers || newObservation.markers.length === 0) {
        return { ...result, reasonCode: "no_markers" };
    }
    // --- Package ownership (exact match required) ---
    const approvedPkg = binding.approvedDestinationProfile.packageName;
    const observedPkg = newObservation.packageName;
    if (approvedPkg && observedPkg) {
        if (normalizeMarkerValue(approvedPkg) !== normalizeMarkerValue(observedPkg)) {
            return { ...result, packageMatched: false, reasonCode: "package_mismatch" };
        }
        result.packageMatched = true;
    }
    else if (approvedPkg && !observedPkg) {
        return { ...result, packageMatched: false, reasonCode: "package_mismatch" };
    }
    else {
        // Neither has package info — proceed without package constraint
        result.packageMatched = true;
    }
    // --- Fingerprint exact match ---
    const approvedFp = binding.approvedDestinationProfile.fingerprint;
    const observedFp = newObservation.fingerprint;
    if (approvedFp && observedFp && normalizeMarkerValue(approvedFp) === normalizeMarkerValue(observedFp)) {
        result.fingerprintMatched = true;
        result.matched = true;
        result.reasonCode = "exact_fingerprint_match";
        return result;
    }
    // --- Structured marker fallback (fingerprint mismatch) ---
    // Build index of approved strong markers
    const approvedStrongMarkers = new Map(); // normalizedValue → kind
    for (const m of binding.approvedDestinationProfile.markers) {
        if (STRONG_MARKER_KINDS.has(m.kind)) {
            approvedStrongMarkers.set(normalizeMarkerValue(m.value), m.kind);
        }
    }
    if (approvedStrongMarkers.size === 0) {
        return { ...result, reasonCode: "insufficient_stable_evidence" };
    }
    // Find strong markers in the new observation that match approved strong markers
    const matchedStrong = [];
    for (const m of newObservation.markers) {
        if (!STRONG_MARKER_KINDS.has(m.kind))
            continue;
        const normalizedVal = normalizeMarkerValue(m.value);
        if (approvedStrongMarkers.has(normalizedVal)) {
            matchedStrong.push({ kind: m.kind, value: m.value });
        }
    }
    result.matchedStrongMarkers = matchedStrong;
    // Require at least 2 distinct exact strong markers
    if (matchedStrong.length >= 2) {
        result.matched = true;
        result.reasonCode = "stable_markers_match";
        return result;
    }
    return { ...result, reasonCode: "insufficient_stable_evidence" };
}
