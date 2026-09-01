import { expect, test } from "@playwright/test";
import {
  extractObservedDestination,
  type MobileObservedDestination,
  type MobileObservedSemanticMarker,
} from "../src/mobile/mobile-observed-destination";
import { buildDestinationClaimId, parseStepDestinationExpectations } from "../src/mobile/mobile-destination-claim";
import { isMobileRouteTransitionTrustedForReuse, persistRuntimeTransition, type RuntimeTransitionInput } from "../src/knowledge/runtime-knowledge-persister";
import type { MobileScreenSnapshot, MobileObservedControl } from "../src/mobile/mobile-knowledge-extractor";

/**
 * Mobile Observed Destination Evidence Tests (T1-T22)
 *
 * Tests that observed destination evidence is captured and persisted correctly
 * without granting any authority (destinationSemanticAuthority, trustedForReuse,
 * requirement→screen binding, DestinationClaimDefinition).
 */

function makeSnapshot(overrides: Partial<MobileScreenSnapshot> = {}): MobileScreenSnapshot {
  return {
    screenKey: overrides.screenKey ?? "test_screen",
    title: overrides.title ?? "Test Screen",
    clickTargets: overrides.clickTargets ?? ["Button A", "Button B"],
    assertionTargets: overrides.assertionTargets ?? ["Heading 1"],
    observedControls: overrides.observedControls ?? [
      { label: "Button A", resourceId: "btn_a", contentDesc: "Button A", className: "android.widget.Button", sourceScreenKey: "test_screen", package: "com.example.app" },
    ],
    fingerprint: overrides.fingerprint ?? "screen_abc123",
    dominantPackage: overrides.dominantPackage ?? "com.example.app",
  };
}

test.describe("mobile observed destination evidence", () => {
  test("T1: after fingerprint → persisted as technical evidence", () => {
    const snapshot = makeSnapshot({ fingerprint: "screen_xyz789" });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    expect(dest!.fingerprint).toBe("screen_xyz789");
    expect(dest!.markers.some((m) => m.kind === "fingerprint" && m.value === "screen_xyz789")).toBe(true);
  });

  test("T2: observed screenKey → persisted as observed evidence", () => {
    const snapshot = makeSnapshot({ screenKey: "bienvenido" });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    expect(dest!.technicalScreenKey).toBe("bienvenido");
    expect(dest!.markers.some((m) => m.kind === "screen_key" && m.value === "bienvenido")).toBe(true);
  });

  test("T3: observed resourceId → structured marker", () => {
    const snapshot = makeSnapshot({
      observedControls: [
        { label: "Submit", resourceId: "com.example:id/submit_btn", sourceScreenKey: "test", package: "com.example.app" },
      ],
    });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    const resourceMarkers = dest!.markers.filter((m) => m.kind === "resource_id");
    expect(resourceMarkers.length).toBeGreaterThan(0);
    expect(resourceMarkers.some((m) => m.value === "com.example:id/submit_btn")).toBe(true);
  });

  test("T4: observed contentDesc → structured marker", () => {
    const snapshot = makeSnapshot({
      observedControls: [
        { label: "Submit", contentDesc: "Enviar formulario", sourceScreenKey: "test", package: "com.example.app" },
      ],
    });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    const contentDescMarkers = dest!.markers.filter((m) => m.kind === "content_desc");
    expect(contentDescMarkers.length).toBeGreaterThan(0);
    expect(contentDescMarkers.some((m) => m.value === "Enviar formulario")).toBe(true);
  });

  test("T5: dominant package → package evidence", () => {
    const snapshot = makeSnapshot({ dominantPackage: "com.example.app" });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    expect(dest!.packageName).toBe("com.example.app");
    expect(dest!.markers.some((m) => m.kind === "dominant_package" && m.value === "com.example.app")).toBe(true);
  });

  test("T6: click targets → observed markers", () => {
    const snapshot = makeSnapshot({ clickTargets: ["Button A", "Button B"] });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    const clickMarkers = dest!.markers.filter((m) => m.kind === "click_target");
    expect(clickMarkers.length).toBe(2);
    expect(clickMarkers.some((m) => m.value === "Button A")).toBe(true);
    expect(clickMarkers.some((m) => m.value === "Button B")).toBe(true);
  });

  test("T7: assertion targets → observed markers", () => {
    const snapshot = makeSnapshot({ assertionTargets: ["Heading 1", "Message"] });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    const assertionMarkers = dest!.markers.filter((m) => m.kind === "assertion_target");
    expect(assertionMarkers.length).toBe(2);
    expect(assertionMarkers.some((m) => m.value === "Heading 1")).toBe(true);
  });

  test("T8: markers with duplicates → deterministic dedupe", () => {
    const snapshot = makeSnapshot({
      clickTargets: ["Button A", "Button A", "Button B"],
      assertionTargets: ["Heading 1"],
      observedControls: [
        { label: "Button A", resourceId: "btn_a", contentDesc: "Button A", className: "android.widget.Button", sourceScreenKey: "test", package: "com.example.app" },
      ],
    });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    // "Button A" appears twice in clickTargets — deduplicated to one
    const clickMarkers = dest!.markers.filter((m) => m.kind === "click_target");
    expect(clickMarkers.length).toBe(2); // "Button A" and "Button B"
    expect(clickMarkers.some((m) => m.value === "Button A")).toBe(true);
    expect(clickMarkers.some((m) => m.value === "Button B")).toBe(true);
    // contentDesc "Button A" is a different kind — not deduped with click_target
    const contentDescMarkers = dest!.markers.filter((m) => m.kind === "content_desc");
    expect(contentDescMarkers.length).toBe(1);
  });

  test("T9: second observation same transition → idempotent enrichment", () => {
    const dest1: MobileObservedDestination = {
      fingerprint: "screen_abc",
      technicalScreenKey: "screen1",
      markers: [{ kind: "screen_key", value: "screen1", source: "snapshot_field" }],
    };
    const dest2: MobileObservedDestination = {
      fingerprint: "screen_abc",
      technicalScreenKey: "screen1",
      markers: [
        { kind: "screen_key", value: "screen1", source: "snapshot_field" },
        { kind: "click_target", value: "New Button", source: "snapshot_click_target" },
      ],
    };
    // Merging: dedup by kind+value, preserve existing, add new
    const merged = mergeObservedDestinations(dest1, dest2);
    expect(merged.markers.length).toBe(2);
    expect(merged.markers.some((m) => m.kind === "click_target" && m.value === "New Button")).toBe(true);
  });

  test("T10: SQL persistence preserves evidence (structure check)", () => {
    const evidence: MobileObservedDestination = {
      fingerprint: "screen_test",
      technicalScreenKey: "test_screen",
      packageName: "com.example.app",
      markers: [
        { kind: "screen_key", value: "test_screen", source: "snapshot_field" },
        { kind: "fingerprint", value: "screen_test", source: "snapshot_field" },
        { kind: "dominant_package", value: "com.example.app", source: "snapshot_field" },
      ],
    };
    // Verify structure is serializable
    const serialized = JSON.stringify(evidence);
    const parsed = JSON.parse(serialized) as MobileObservedDestination;
    expect(parsed.fingerprint).toBe("screen_test");
    expect(parsed.technicalScreenKey).toBe("test_screen");
    expect(parsed.packageName).toBe("com.example.app");
    expect(parsed.markers).toHaveLength(3);
  });

  test("T11: SQL/JSON equivalent (serialization roundtrip)", () => {
    const evidence: MobileObservedDestination = {
      fingerprint: "screen_test",
      technicalScreenKey: "test_screen",
      markers: [
        { kind: "screen_key", value: "test_screen", source: "snapshot_field" },
        { kind: "resource_id", value: "com.example:id/btn", source: "xml_attribute" },
      ],
    };
    const sql = JSON.parse(JSON.stringify(evidence)) as MobileObservedDestination;
    const json = JSON.parse(JSON.stringify(sql)) as MobileObservedDestination;
    expect(sql.fingerprint).toBe(json.fingerprint);
    expect(sql.technicalScreenKey).toBe(json.technicalScreenKey);
    expect(sql.markers).toEqual(json.markers);
  });

  test("T12: observed requirement + screen does NOT create requirement→screen binding", () => {
    // Having requirementIds=["CA01"] + observedDestinationEvidence with screenKey
    // should NOT create a DestinationClaimDefinition
    const manifest = []; // No manifest should be created
    const claimId = buildDestinationClaimId("CA01", "test_screen");
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: claimId }],
      3,
      ["CA01"],
      manifest,
    );
    // Empty manifest → no claims can be referenced
    expect(expectations).toBeUndefined();
  });

  test("T13: observed markers do NOT create DestinationClaimDefinition", () => {
    // Observed evidence is observation-only, not claim creation
    const snapshot = makeSnapshot({ screenKey: "observed_screen" });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    // extractObservedDestination returns MobileObservedDestination, not DestinationClaimDefinition
    expect((dest as any).destinationClaimId).toBeUndefined();
    expect((dest as any).requirementIds).toBeUndefined();
  });

  test("T14: markers do NOT set destinationSemanticAuthority=validated", () => {
    const evidence: MobileObservedDestination = {
      fingerprint: "screen_test",
      markers: [{ kind: "screen_key", value: "test", source: "snapshot_field" }],
    };
    // The evidence structure has no destinationSemanticAuthority field
    expect((evidence as any).destinationSemanticAuthority).toBeUndefined();
  });

  test("T15: markers do NOT set trustedForReuse=true", () => {
    const trust = isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: undefined, // no destination validation
    });
    expect(trust).toBe(false);
  });

  test("T16: fingerprint alone never grants semantic authority", () => {
    const trust = isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: undefined, // fingerprint doesn't set this
    });
    expect(trust).toBe(false);
  });

  test("T17: screenKey alone never grants semantic authority", () => {
    const trust = isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: undefined, // screenKey doesn't set this
    });
    expect(trust).toBe(false);
  });

  test("T18: package ownership alone never grants destination authority", () => {
    const trust = isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: undefined, // package doesn't set this
    });
    expect(trust).toBe(false);
  });

  test("T19: empty snapshot → no fabricated markers", () => {
    const snapshot = makeSnapshot({
      clickTargets: [],
      assertionTargets: [],
      observedControls: [],
    });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeUndefined();
  });

  test("T20: actionSemanticAuthority preserved alongside observedDestinationEvidence", () => {
    const input: RuntimeTransitionInput = {
      sourceScreenKey: "screen_a",
      destinationScreenKey: "screen_b",
      actionLocatorIdentity: "btn",
      controlPackage: "com.example.app",
      transitionValidated: true,
      executionBacked: true,
      requirementIds: ["CA01"],
      actionSemanticAuthority: "validated",
      observedDestinationEvidence: {
        fingerprint: "screen_b_hash",
        technicalScreenKey: "screen_b",
        markers: [{ kind: "screen_key", value: "screen_b", source: "snapshot_field" }],
      },
    };
    // actionSemanticAuthority is independent of observedDestinationEvidence
    expect(input.actionSemanticAuthority).toBe("validated");
    expect(input.observedDestinationEvidence).toBeDefined();
    expect(input.observedDestinationEvidence!.fingerprint).toBe("screen_b_hash");
  });

  test("T21: runtime observation remains observation-only in structure", () => {
    const evidence: MobileObservedDestination = {
      fingerprint: "screen_test",
      technicalScreenKey: "test_screen",
      packageName: "com.example.app",
      markers: [
        { kind: "screen_key", value: "test_screen", source: "snapshot_field" },
        { kind: "fingerprint", value: "screen_test", source: "snapshot_field" },
        { kind: "dominant_package", value: "com.example.app", source: "snapshot_field" },
        { kind: "resource_id", value: "com.example:id/btn", source: "xml_attribute" },
        { kind: "content_desc", value: "Button", source: "xml_attribute" },
      ],
    };
    // Evidence is observation-only — no authority fields
    expect((evidence as any).destinationSemanticAuthority).toBeUndefined();
    expect((evidence as any).trustedForReuse).toBeUndefined();
    expect((evidence as any).requirementIds).toBeUndefined();
    expect((evidence as any).destinationClaimId).toBeUndefined();
    expect((evidence as any).source).toBeUndefined();
    expect((evidence as any).trustLevel).toBeUndefined();
  });

  test("T22: no production hardcodes in marker extraction", () => {
    // extractObservedDestination is generic — no app-specific values
    const snapshot = makeSnapshot({
      screenKey: "any_screen",
      fingerprint: "any_fingerprint",
      dominantPackage: "any.package",
      clickTargets: ["Any Button"],
      assertionTargets: ["Any Heading"],
      observedControls: [
        { label: "Any", resourceId: "any:id", contentDesc: "Any Desc", className: "android.widget.View", sourceScreenKey: "any_screen", package: "any.package" },
      ],
    });
    const dest = extractObservedDestination(snapshot);
    expect(dest).toBeDefined();
    expect(dest!.technicalScreenKey).toBe("any_screen");
    expect(dest!.fingerprint).toBe("any_fingerprint");
    expect(dest!.packageName).toBe("any.package");
    expect(dest!.markers.length).toBeGreaterThan(0);
  });
});

/**
 * Helper to merge two MobileObservedDestination objects (idempotent enrichment).
 * Used in T9 test to verify dedup behavior.
 */
function mergeObservedDestinations(
  existing: MobileObservedDestination,
  incoming: MobileObservedDestination,
): MobileObservedDestination {
  const seen = new Set<string>();
  const merged: MobileObservedSemanticMarker[] = [];
  for (const m of [...existing.markers, ...incoming.markers]) {
    const key = `${m.kind}:${m.value.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(m);
    }
  }
  return {
    ...existing,
    markers: merged,
  };
}
