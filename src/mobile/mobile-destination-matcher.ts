import type { MobileAuthoritativeDestinationBinding } from "./mobile-destination-binding";
import type { MobileObservedDestination, MobileObservedSemanticMarker } from "./mobile-observed-destination";

/**
 * Mobile destination matcher — deterministic comparison between:
 * - EXPECTED: MobileAuthoritativeDestinationBinding.approvedDestinationProfile
 * - OBSERVED: a NEW MobileObservedDestination produced by runtime
 *
 * The matcher does NOT decide what functional destination is expected.
 * That is determined by the validated authoritative binding + DestinationClaimDefinition.
 *
 * The matcher only answers: "does the new observation correspond to the
 * technical/observable profile that was previously approved for that destination?"
 *
 * No fuzzy matching. No LLM. No embeddings. Pure structural comparison.
 */

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** Marker kind classification for matching evidence strength. */
type MarkerClassification = "strong" | "weak";

const STRONG_MARKER_KINDS: ReadonlySet<string> = new Set([
  "resource_id",
  "content_desc",
  "heading",
]);

const WEAK_MARKER_KINDS: ReadonlySet<string> = new Set([
  "screen_key",
  "click_target",
  "assertion_target",
  "observed_control_class",
  "fingerprint",
  "dominant_package",
]);

/** Result of matching a new observation against an approved profile. */
export type MobileDestinationMatchResult = {
  /** Whether the observation matches the approved profile. */
  matched: boolean;
  /** Machine-readable reason code for the match/mismatch. */
  reasonCode: string;
  /** The binding ID that was checked against. */
  bindingId: string;
  /** Whether the package matched exactly. */
  packageMatched: boolean;
  /** Whether the fingerprint matched exactly. */
  fingerprintMatched: boolean;
  /** Markers from the observation that matched strong markers in the profile. */
  matchedStrongMarkers: Array<{ kind: string; value: string }>;
  /** Whether the observation is independent (different transition from approval). */
  independentObservation: boolean;
};

/** Reason codes for match/mismatch. */
export type MatchReasonCode =
  | "exact_fingerprint_match"
  | "stable_markers_match"
  | "package_mismatch"
  | "self_match"
  | "binding_not_validated"
  | "binding_missing"
  | "insufficient_stable_evidence"
  | "independent_observation_required"
  | "no_markers";

// ---------------------------------------------------------------------------
// NORMALIZATION
// ---------------------------------------------------------------------------

/**
 * Normalize a marker value for deterministic comparison.
 * Unicode NFC + trim + lowercase. No semantic relaxation.
 */
function normalizeMarkerValue(value: string): string {
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
export function matchDestinationProfile(
  binding: MobileAuthoritativeDestinationBinding | null | undefined,
  newObservation: MobileObservedDestination | undefined,
  currentTransitionId: string,
): MobileDestinationMatchResult {
  const defaultResult: MobileDestinationMatchResult = {
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

  const result: MobileDestinationMatchResult = {
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
  } else if (approvedPkg && !observedPkg) {
    return { ...result, packageMatched: false, reasonCode: "package_mismatch" };
  } else {
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
  const approvedStrongMarkers = new Map<string, string>(); // normalizedValue → kind
  for (const m of binding.approvedDestinationProfile.markers) {
    if (STRONG_MARKER_KINDS.has(m.kind)) {
      approvedStrongMarkers.set(normalizeMarkerValue(m.value), m.kind);
    }
  }

  if (approvedStrongMarkers.size === 0) {
    return { ...result, reasonCode: "insufficient_stable_evidence" };
  }

  // Find strong markers in the new observation that match approved strong markers
  const matchedStrong: Array<{ kind: string; value: string }> = [];
  for (const m of newObservation.markers) {
    if (!STRONG_MARKER_KINDS.has(m.kind)) continue;
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
