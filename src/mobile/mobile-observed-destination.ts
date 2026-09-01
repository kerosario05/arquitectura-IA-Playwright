import type { MobileScreenSnapshot } from "./mobile-knowledge-extractor";

/**
 * Structured evidence of an observed destination screen after a transition.
 *
 * This is OBSERVATION-ONLY evidence — it captures what Appium saw on the screen,
 * NOT what the screen "means" functionally. It does NOT grant:
 * - destinationSemanticAuthority
 * - trustedForReuse
 * - requirement→screen binding
 * - DestinationClaimDefinition
 *
 * Each marker has an explicit kind and normalized value for deterministic dedup.
 */

/** Kind of semantic marker observed on the destination screen. */
export type MobileSemanticMarkerKind =
  | "screen_key"
  | "fingerprint"
  | "dominant_package"
  | "resource_id"
  | "content_desc"
  | "heading"
  | "click_target"
  | "assertion_target"
  | "observed_control_class";

/** A single structured marker observed on the destination screen. */
export type MobileObservedSemanticMarker = {
  /** Explicit kind of this marker (deterministic, no inference). */
  kind: MobileSemanticMarkerKind;
  /** Normalized value (trim, dedupe-safe). */
  value: string;
  /** Source of this marker (e.g. "xml_attribute", "snapshot_field", "extracted_control"). */
  source: string;
};

/**
 * Structured evidence of the observed destination screen after a transition.
 * Captured from the Appium page source snapshot — NOT from any semantic classification.
 */
export type MobileObservedDestination = {
  /** Technical screen key (fingerprint hash from extractMobileScreenSnapshot). */
  technicalScreenKey?: string;
  /** Stable structural fingerprint (screen_<hash>). */
  fingerprint?: string;
  /** Android package that owns the majority of controls. */
  packageName?: string;
  /** Activity name if available from the snapshot. */
  activity?: string;
  /** Structured markers observed on the destination screen. Deduplicated by kind+value. */
  markers: MobileObservedSemanticMarker[];
};

/**
 * Extract observed destination evidence from an Appium screen snapshot.
 * This is a pure function — no side effects, no authority granting.
 *
 * Returns undefined if the snapshot is empty or has no usable content.
 */
export function extractObservedDestination(
  snapshot: MobileScreenSnapshot | undefined,
): MobileObservedDestination | undefined {
  if (!snapshot) return undefined;
  if (snapshot.clickTargets.length === 0 && snapshot.assertionTargets.length === 0 && snapshot.observedControls.length === 0) {
    return undefined;
  }

  const markers: MobileObservedSemanticMarker[] = [];

  // Screen key as observed marker
  if (snapshot.screenKey) {
    markers.push({ kind: "screen_key", value: snapshot.screenKey, source: "snapshot_field" });
  }

  // Fingerprint as technical marker
  if (snapshot.fingerprint) {
    markers.push({ kind: "fingerprint", value: snapshot.fingerprint, source: "snapshot_field" });
  }

  // Dominant package as ownership evidence
  if (snapshot.dominantPackage) {
    markers.push({ kind: "dominant_package", value: snapshot.dominantPackage, source: "snapshot_field" });
  }

  // Click targets as observed markers
  for (const target of snapshot.clickTargets) {
    const trimmed = target.trim();
    if (trimmed) {
      markers.push({ kind: "click_target", value: trimmed, source: "snapshot_click_target" });
    }
  }

  // Assertion targets as observed markers
  for (const target of snapshot.assertionTargets) {
    const trimmed = target.trim();
    if (trimmed) {
      markers.push({ kind: "assertion_target", value: trimmed, source: "snapshot_assertion_target" });
    }
  }

  // Observed controls: extract resourceId, contentDesc, className
  for (const control of snapshot.observedControls) {
    if (control.resourceId) {
      markers.push({ kind: "resource_id", value: control.resourceId.trim(), source: "xml_attribute" });
    }
    if (control.contentDesc) {
      markers.push({ kind: "content_desc", value: control.contentDesc.trim(), source: "xml_attribute" });
    }
    if (control.className) {
      markers.push({ kind: "observed_control_class", value: control.className.trim(), source: "xml_attribute" });
    }
  }

  // Deduplicate by kind + normalized value (deterministic, order-stable)
  const seen = new Set<string>();
  const deduped: MobileObservedSemanticMarker[] = [];
  for (const m of markers) {
    const key = `${m.kind}:${m.value.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }

  return {
    ...(snapshot.fingerprint ? { fingerprint: snapshot.fingerprint } : {}),
    ...(snapshot.screenKey ? { technicalScreenKey: snapshot.screenKey } : {}),
    ...(snapshot.dominantPackage ? { packageName: snapshot.dominantPackage } : {}),
    markers: deduped,
  };
}
